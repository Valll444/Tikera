// Logica compartida para hablar con los servicios de ARCA (ex-AFIP) desde
// las dos Edge Functions de facturacion (arca-config, arca-facturar).
//
// No se usa la libreria npm "afip.ts"/AfipSDK: depende de paquetes de Node
// (soap, node-forge) sin garantia de andar en Deno y el proyecto esta sin
// mantenimiento activo. En cambio: fetch nativo para los POST SOAP, y
// pkijs/asn1js (pensados para Web Crypto, no para Buffer/streams de Node)
// para la firma CMS que pide el login de WSAA -- verificado con un spike
// antes de escribir esto: ambas importan y firman bien en Deno.
import * as asn1js from "npm:asn1js@3";
import * as pkijs from "npm:pkijs@3";
import { XMLParser } from "npm:fast-xml-parser@4";

pkijs.setEngine("deno", new pkijs.CryptoEngine({ name: "deno", crypto }));

const xmlParser = new XMLParser({ ignoreAttributes: false });

export const ARCA_ENDPOINTS = {
  homologacion: {
    wsaa: "https://wsaahomo.afip.gov.ar/ws/services/LoginCms",
    wsfe: "https://wswhomo.afip.gov.ar/wsfev1/service.asmx",
  },
  produccion: {
    wsaa: "https://wsaa.afip.gov.ar/ws/services/LoginCms",
    wsfe: "https://servicios1.afip.gov.ar/wsfev1/service.asmx",
  },
} as const;

// Codigo de tipo de comprobante que espera WSFEv1. V1 de Tikera solo
// factura C (Monotributo) -- A/B quedan reservados pero sin implementar.
export const CBTE_TIPO: Record<string, number> = { A: 1, B: 6, C: 11 };

// --- Cifrado del certificado/clave privada en reposo (AES-GCM, Web Crypto) ---
// La clave de cifrado nunca esta en esta base: vive solo como secret de la
// funcion (ARCA_CERT_ENC_KEY). Un bucket de Storage mal configurado ya nos
// mordio una vez en este proyecto (006/012) -- una columna cifrada falla
// mas seguro: un grant de mas expone ruido, no la clave en texto plano.
async function getEncryptionKey(): Promise<CryptoKey> {
  const secret = Deno.env.get("ARCA_CERT_ENC_KEY");
  if (!secret) throw new Error("Falta configurar el secret ARCA_CERT_ENC_KEY.");
  const keyBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(plaintext: string): Promise<string> {
  const key = await getEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(plaintext);
  const cipherBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
  const out = new Uint8Array(iv.length + cipherBuf.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(cipherBuf), iv.length);
  return base64Encode(out);
}

export async function decryptSecret(encoded: string): Promise<string> {
  const key = await getEncryptionKey();
  const bytes = base64Decode(encoded);
  const iv = bytes.slice(0, 12);
  const cipherBuf = bytes.slice(12);
  const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipherBuf);
  return new TextDecoder().decode(plainBuf);
}

function base64Encode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
function base64Decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----BEGIN [^-]+-----/, "").replace(/-----END [^-]+-----/, "").replace(/\s+/g, "");
  return base64Decode(b64).buffer as ArrayBuffer;
}

// --- CUIT: validacion del digito verificador (modulo 11) ---
// Implementado contra el algoritmo publicado; igual hay que probarlo con
// CUITs reales conocidos antes de confiar en el ciegamente (ver plan).
export function validarCuit(cuitRaw: string): boolean {
  const d = (cuitRaw || "").replace(/\D/g, "");
  if (d.length !== 11) return false;
  const coef = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let suma = 0;
  for (let i = 0; i < 10; i++) suma += parseInt(d[i], 10) * coef[i];
  const mod = suma % 11;
  let digitoEsperado = 11 - mod;
  if (digitoEsperado === 11) digitoEsperado = 0;
  if (digitoEsperado === 10) return false;
  return digitoEsperado === parseInt(d[10], 10);
}

// Un certificado de ARCA suele traer la clave privada en formato PKCS#1
// ("BEGIN RSA PRIVATE KEY"), que Web Crypto no puede importar directo --
// solo entiende PKCS#8 ("BEGIN PRIVATE KEY"). Si hace falta, convertir con:
//   openssl pkcs8 -topk8 -nocrypt -in clave.key -out clave_pkcs8.key
export function esFormatoPkcs8(pem: string): boolean {
  return /-----BEGIN PRIVATE KEY-----/.test(pem);
}

// --- WSAA: login y firma CMS del "loginTicketRequest" ---
export interface WsaaTicket {
  token: string;
  sign: string;
  expirationTime: string; // ISO
}

export async function loginWSAA(
  certPem: string,
  clavePrivadaPem: string,
  ambiente: "homologacion" | "produccion",
): Promise<WsaaTicket> {
  if (!esFormatoPkcs8(clavePrivadaPem)) {
    throw new Error(
      "La clave privada no esta en formato PKCS#8. Convertila con: openssl pkcs8 -topk8 -nocrypt -in clave.key -out clave_pkcs8.key",
    );
  }

  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(clavePrivadaPem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const cert = pkijs.Certificate.fromBER(pemToArrayBuffer(certPem));

  const now = new Date();
  const generationTime = new Date(now.getTime() - 10 * 60_000);
  const expirationTime = new Date(now.getTime() + 10 * 60_000);
  const loginTicketRequestXml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<loginTicketRequest version="1.0">` +
    `<header><uniqueId>${Math.floor(now.getTime() / 1000)}</uniqueId>` +
    `<generationTime>${generationTime.toISOString()}</generationTime>` +
    `<expirationTime>${expirationTime.toISOString()}</expirationTime></header>` +
    `<service>wsfe</service></loginTicketRequest>`;

  const contenido = new TextEncoder().encode(loginTicketRequestXml);
  const cmsSigned = new pkijs.SignedData({
    version: 1,
    encapContentInfo: new pkijs.EncapsulatedContentInfo({
      eContentType: "1.2.840.113549.1.7.1",
      eContent: new asn1js.OctetString({ valueHex: contenido }),
    }),
    signerInfos: [
      new pkijs.SignerInfo({
        version: 1,
        sid: new pkijs.IssuerAndSerialNumber({ issuer: cert.issuer, serialNumber: cert.serialNumber }),
      }),
    ],
    certificates: [cert],
  });
  await cmsSigned.sign(privateKey, 0, "SHA-256", contenido);
  const cmsInfo = new pkijs.ContentInfo({ contentType: "1.2.840.113549.1.7.2", content: cmsSigned.toSchema(true) });
  const cmsB64 = base64Encode(new Uint8Array(cmsInfo.toSchema().toBER(false)));

  const soapBody =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">` +
    `<soapenv:Header/><soapenv:Body><wsaa:loginCms><wsaa:in0>${cmsB64}</wsaa:in0></wsaa:loginCms></soapenv:Body></soapenv:Envelope>`;

  const res = await fetch(ARCA_ENDPOINTS[ambiente].wsaa, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: "" },
    body: soapBody,
  });
  const resText = await res.text();
  if (!res.ok) throw new Error(`WSAA respondio ${res.status}: ${resText.slice(0, 300)}`);

  const envelope = xmlParser.parse(resText);
  const loginCmsReturn = envelope?.["soapenv:Envelope"]?.["soapenv:Body"]?.["loginCmsResponse"]?.["loginCmsReturn"];
  if (!loginCmsReturn) throw new Error(`No se pudo leer la respuesta de WSAA: ${resText.slice(0, 300)}`);
  const ticket = xmlParser.parse(loginCmsReturn);
  const token = ticket?.loginTicketResponse?.credentials?.token;
  const sign = ticket?.loginTicketResponse?.credentials?.sign;
  const expirationTime2 = ticket?.loginTicketResponse?.header?.expirationTime;
  if (!token || !sign) throw new Error(`WSAA no devolvio token/sign: ${resText.slice(0, 300)}`);

  return { token, sign, expirationTime: expirationTime2 || expirationTime.toISOString() };
}

// --- WSFEv1 ---
async function wsfeCall(ambiente: "homologacion" | "produccion", soapAction: string, bodyXml: string): Promise<any> {
  const envelope =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/">` +
    `<soapenv:Header/><soapenv:Body>${bodyXml}</soapenv:Body></soapenv:Envelope>`;

  const res = await fetch(ARCA_ENDPOINTS[ambiente].wsfe, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: soapAction },
    body: envelope,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`WSFEv1 respondio ${res.status}: ${text.slice(0, 300)}`);
  return xmlParser.parse(text);
}

export async function feCompUltimoAutorizado(
  ambiente: "homologacion" | "produccion",
  auth: WsaaTicket,
  cuit: string,
  ptoVta: number,
  tipoComprobante: "A" | "B" | "C",
): Promise<number> {
  const body =
    `<ar:FECompUltimoAutorizado>` +
    `<ar:Auth><ar:Token>${auth.token}</ar:Token><ar:Sign>${auth.sign}</ar:Sign><ar:Cuit>${cuit}</ar:Cuit></ar:Auth>` +
    `<ar:PtoVta>${ptoVta}</ar:PtoVta><ar:CbteTipo>${CBTE_TIPO[tipoComprobante]}</ar:CbteTipo>` +
    `</ar:FECompUltimoAutorizado>`;
  const parsed = await wsfeCall(ambiente, "http://ar.gov.afip.dif.FEV1/FECompUltimoAutorizado", body);
  const result = parsed?.["soapenv:Envelope"]?.["soapenv:Body"]?.["FECompUltimoAutorizadoResponse"]?.["FECompUltimoAutorizadoResult"];
  const numero = Number(result?.CbteNro ?? 0);
  return numero;
}

export interface FacturarResult {
  cae: string;
  caeVencimiento: string;
  numero: number;
  errores?: string;
}

export async function feCAESolicitar(
  ambiente: "homologacion" | "produccion",
  auth: WsaaTicket,
  cuit: string,
  ptoVta: number,
  tipoComprobante: "A" | "B" | "C",
  numero: number,
  monto: number,
  fecha: string, // YYYYMMDD
): Promise<FacturarResult> {
  const cbteTipo = CBTE_TIPO[tipoComprobante];
  const impTotal = monto.toFixed(2);
  const body =
    `<ar:FECAESolicitar>` +
    `<ar:Auth><ar:Token>${auth.token}</ar:Token><ar:Sign>${auth.sign}</ar:Sign><ar:Cuit>${cuit}</ar:Cuit></ar:Auth>` +
    `<ar:FeCAEReq>` +
    `<ar:FeCabReq><ar:CantReg>1</ar:CantReg><ar:PtoVta>${ptoVta}</ar:PtoVta><ar:CbteTipo>${cbteTipo}</ar:CbteTipo></ar:FeCabReq>` +
    `<ar:FeDetReq><ar:FECAEDetRequest>` +
    `<ar:Concepto>1</ar:Concepto><ar:DocTipo>99</ar:DocTipo><ar:DocNro>0</ar:DocNro>` +
    `<ar:CbteDesde>${numero}</ar:CbteDesde><ar:CbteHasta>${numero}</ar:CbteHasta><ar:CbteFch>${fecha}</ar:CbteFch>` +
    `<ar:ImpTotal>${impTotal}</ar:ImpTotal><ar:ImpTotConc>0</ar:ImpTotConc><ar:ImpNeto>${impTotal}</ar:ImpNeto>` +
    `<ar:ImpOpEx>0</ar:ImpOpEx><ar:ImpIVA>0</ar:ImpIVA><ar:ImpTrib>0</ar:ImpTrib>` +
    `<ar:MonId>PES</ar:MonId><ar:MonCotiz>1</ar:MonCotiz>` +
    `</ar:FECAEDetRequest></ar:FeDetReq>` +
    `</ar:FeCAEReq></ar:FECAESolicitar>`;

  const parsed = await wsfeCall(ambiente, "http://ar.gov.afip.dif.FEV1/FECAESolicitar", body);
  const result = parsed?.["soapenv:Envelope"]?.["soapenv:Body"]?.["FECAESolicitarResponse"]?.["FECAESolicitarResult"];

  const errores = result?.Errors?.Err;
  if (errores) {
    const msg = Array.isArray(errores) ? errores.map((e: any) => e.Msg).join("; ") : errores.Msg;
    throw new Error(`ARCA rechazo el comprobante: ${msg}`);
  }

  const detResp = result?.FeDetResp?.FECAEDetResponse;
  if (!detResp || detResp.Resultado !== "A") {
    const obs = detResp?.Observaciones?.Obs;
    const msg = obs ? (Array.isArray(obs) ? obs.map((o: any) => o.Msg).join("; ") : obs.Msg) : "Rechazado sin detalle.";
    throw new Error(`ARCA no autorizo el comprobante: ${msg}`);
  }

  return {
    cae: String(detResp.CAE),
    caeVencimiento: String(detResp.CAEFchVto), // YYYYMMDD
    numero,
  };
}
