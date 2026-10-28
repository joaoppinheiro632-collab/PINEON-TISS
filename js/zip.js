// XML TISS pode vir declarado como UTF-8 ou ISO-8859-1 (Latin1), dependendo do
// software que gerou o lote. Ler tudo como ISO-8859-1 corrompe acentuação de
// lotes UTF-8 (ex: "é" vira "Ã©"). Aqui lemos o prólogo do XML (que é ASCII puro
// nos dois encodings) pra descobrir o encoding declarado antes de decodificar
// o arquivo inteiro com o TextDecoder correto.
export function detectXmlEncoding(buffer) {
    // O prólogo <?xml ...?> está sempre nos primeiros bytes e é ASCII-safe
    // em ambos os encodings, então dá pra ler com ASCII/latin1 sem risco.
    const prologueBytes = buffer.slice(0, 200);
    const prologueText = new TextDecoder("iso-8859-1").decode(prologueBytes);
    const match = prologueText.match(/encoding=["']([^"']+)["']/i);
    const declared = match ? match[1].toLowerCase() : null;

    if (declared && (declared.includes('utf-8') || declared === 'utf8')) {
        return 'utf-8';
    }
    if (declared && (declared.includes('8859-1') || declared.includes('latin1') || declared.includes('latin-1'))) {
        return 'iso-8859-1';
    }
    // Sem declaração explícita: tenta decodificar como UTF-8 estrito; se os
    // bytes não formarem UTF-8 válido, TextDecoder com fatal:true lança erro
    // e caímos para ISO-8859-1, que aceita qualquer sequência de bytes.
    try {
        new TextDecoder("utf-8", { fatal: true }).decode(buffer);
        return 'utf-8';
    } catch {
        return 'iso-8859-1';
    }
}

// Limite defensivo contra "zip bombs": um arquivo pequeno no disco pode
// descomprimir para gigabytes e travar a aba. 100MB cobre lotes TISS reais
// com folga; ajuste aqui se algum dia houver um caso legítimo maior.
const MAX_ZIP_SIZE_BYTES = 100 * 1024 * 1024;

export async function loadZipFile(file) {
    if (file.size > MAX_ZIP_SIZE_BYTES) {
        const limitMB = (MAX_ZIP_SIZE_BYTES / 1024 / 1024).toFixed(0);
        const fileMB = (file.size / 1024 / 1024).toFixed(1);
        throw new Error(`Arquivo muito grande (${fileMB}MB). O limite é de ${limitMB}MB.`);
    }

    const zip = new JSZip();
    const zipContent = await zip.loadAsync(file);

    let xmlFileName = Object.keys(zipContent.files).find(name => name.toLowerCase().endsWith('.xml'));

    if (!xmlFileName) {
        throw new Error('Nenhum arquivo XML encontrado dentro do ZIP.');
    }

    const buffer = await zipContent.files[xmlFileName].async("uint8array");
    const encoding = detectXmlEncoding(buffer);
    const decoder = new TextDecoder(encoding);
    const xmlRawText = decoder.decode(buffer);

    return { xmlFileName, xmlRawText, encoding };
}

export async function loadXmlFile(file) {
    if (file.size > MAX_ZIP_SIZE_BYTES) {
        const limitMB = (MAX_ZIP_SIZE_BYTES / 1024 / 1024).toFixed(0);
        const fileMB = (file.size / 1024 / 1024).toFixed(1);
        throw new Error(`Arquivo muito grande (${fileMB}MB). O limite é de ${limitMB}MB.`);
    }

    const buffer = new Uint8Array(await file.arrayBuffer());
    const encoding = detectXmlEncoding(buffer);
    const decoder = new TextDecoder(encoding);
    const xmlRawText = decoder.decode(buffer);

    return { xmlFileName: file.name, xmlRawText, encoding };
}

export async function generateZipBlob(xmlFilename, xmlContent) {
    const zip = new JSZip();
    zip.file(xmlFilename, xmlContent);
    return await zip.generateAsync({ type: "blob" });
}