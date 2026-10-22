import { getTagVal, findLineNumber } from '../../utils/xml.js';
import { parseDate } from '../../utils/date.js';

export default {
    id: "REG003",
    descricao: "Validar Datas de Execução fora do Período",
    executeProcedimento(procNode, context) {
        const dtInicioFat = parseDate(getTagVal(context.guiaNode, 'dataInicioFaturamento'));
        const dtFimFat = parseDate(getTagVal(context.guiaNode, 'dataFinalFaturamento'));
        const dtExecStr = getTagVal(procNode, 'dataExecucao');
        const dtExec = parseDate(dtExecStr);

        if (dtExec && dtInicioFat && dtFimFat) {
            if (dtExec < dtInicioFat || dtExec > dtFimFat) {
                // Busca a partir de onde o item anterior terminou (não da
                // linha do código do procedimento) — no TISS, <dataExecucao>
                // vem ANTES de <codigoProcedimento> dentro do mesmo item.
                const limiteInferior = context.limiteInferiorLinha ?? (context.procLinha - 1);
                const linhaData = findLineNumber(context.linesArray, 'dataExecucao', limiteInferior);
                context.results.erros.push({
                    linha: linhaData,
                    guia: context.identificadorGuia,
                    item: context.seqItem,
                    codigo: context.codProc,
                    descricao: context.descProc,
                    tipo: "Erro",
                    categoria: "datas",
                    mensagem: `Data de execução (${dtExecStr}) fora do período faturado.`,
                    targetTag: "dataExecucao"
                });
                context.results.categorias.datas++;
            }
        }
    }
};