import { getTagVal, findLineNumber } from '../../utils/xml.js';

export default {
    id: "REG005",
    descricao: "Validar Formato e Tamanho do Código de Procedimento/Despesa",
    executeProcedimento(procNode, context) {
        const codProc = (getTagVal(procNode, 'codigoProcedimento') || '').trim();

        if (!codProc) return;

        const linhaCod = findLineNumber(context.linesArray, codProc, context.procLinha - 1);

        // 1. Erro: Código iniciado com zero
        if (/^0/.test(codProc)) {
            context.results.erros.push({
                linha: linhaCod,
                guia: context.identificadorGuia,
                item: context.seqItem || "-",
                codigo: codProc,
                descricao: context.descProc,
                tipo: "Erro",
                categoria: "estrut",
                mensagem: `Código (${codProc}) iniciado por zero.`,
                targetTag: codProc
            });
            context.results.categorias.estrut++;
            return; // Retorna para evitar erro duplicado na mesma linha
        }

        // 2. Erro: Código com 6 ou menos caracteres/dígitos
        if (codProc.length <= 6) {
            context.results.erros.push({
                linha: linhaCod,
                guia: context.identificadorGuia,
                item: context.seqItem || "-",
                codigo: codProc,
                descricao: context.descProc,
                tipo: "Erro",
                categoria: "estrut",
                mensagem: `Código (${codProc}) possui ${codProc.length} dígito(s). Esperado código TISS válido com mais de 6 dígitos.`,
                targetTag: codProc
            });
            context.results.categorias.estrut++;
            return;
        }

        // 3. Erro: Código com 11 ou mais caracteres/dígitos (mais de 10)
        if (codProc.length > 10) {
            context.results.erros.push({
                linha: linhaCod,
                guia: context.identificadorGuia,
                item: context.seqItem || "-",
                codigo: codProc,
                descricao: context.descProc,
                tipo: "Erro",
                categoria: "estrut",
                mensagem: `Código (${codProc}) possui ${codProc.length} dígitos. O limite máximo permitido no padrão é de 10 dígitos.`,
                targetTag: codProc
            });
            context.results.categorias.estrut++;
            return;
        }
    }
};