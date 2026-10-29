// Aplica uma correção automática (autoFix) sobre as linhas do XML.
// Lógica pura (sem DOM), usada pelo botão Corrigir e pelo "Corrigir todas".
//
// autoFix = { campo, tag, valorNovo, inicioGuia, fimGuia }
//   - tag: nome da tag no XML (sem prefixo e sem caminho);
//   - inicioGuia..fimGuia: faixa de linhas (1-based, inclusive) onde a tag pode ser
//     alterada — a guia, o item, ou a linha exata da ocorrência. Nunca fora dela.
//
// Troca o conteúdo da PRIMEIRA linha da faixa que tenha <tag>valor</tag> e
// devolve o índice (0-based) da linha alterada, ou -1 se não achou.
export function corrigirLinhas(linhas, autoFix) {
    const tag = autoFix.tag || autoFix.campo;
    // Tag pode ou não ter prefixo de namespace (<ans:campo> ou <campo>).
    // O nome foi validado ao salvar a regra (REGEX_NOME_TAG).
    const regexTag = new RegExp(`(<(?:[A-Za-z0-9_-]+:)?${tag}>)([^<]*)(</(?:[A-Za-z0-9_-]+:)?${tag}>)`);

    for (let i = Math.max(autoFix.inicioGuia - 1, 0); i < Math.min(autoFix.fimGuia, linhas.length); i++) {
        if (regexTag.test(linhas[i])) {
            const valorXml = String(autoFix.valorNovo).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            // função no replace: "$1", "$&" etc. no valor digitado não podem virar padrão de substituição
            linhas[i] = linhas[i].replace(regexTag, (_, abre, __, fecha) => abre + valorXml + fecha);
            return i;
        }
    }
    return -1;
}
