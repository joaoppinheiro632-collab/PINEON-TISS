import { getTagVal, findLineNumber } from '../../utils/xml.js';
import { formatMoneyBR } from '../../utils/format.js';

export default {
    id: "REG007",
    descricao: "Auditoria e Validação Financeira",
    executeProcedimento(procNode, context) {
        const isConsulta = context.tipoGuia === 'consulta';
        const tagValor = isConsulta ? 'valorProcedimento' : 'valorTotal';
        const valTotal = parseFloat(getTagVal(procNode, tagValor) || 0);

        // guiaConsulta não tem conceito de "quantidade executada" — é
        // sempre uma consulta só, não se aplica.
        if (!isConsulta) {
            const qtdExecRaw = getTagVal(procNode, 'quantidadeExecutada');
            const qtdExec = parseFloat(qtdExecRaw || 0);

            if (!qtdExecRaw || isNaN(qtdExec) || qtdExec <= 0) {
                const linhaQtd = findLineNumber(context.linesArray, 'quantidadeExecutada', context.procLinha - 1);
                context.results.erros.push({
                    linha: linhaQtd,
                    guia: context.identificadorGuia,
                    item: context.seqItem,
                    codigo: context.codProc,
                    descricao: context.descProc,
                    tipo: "Erro",
                    categoria: "fin",
                    mensagem: `Quantidade executada inválida (<= 0).`,
                    targetTag: "quantidadeExecutada"
                });
                context.results.categorias.fin++;
            }
        }

        if (valTotal === 0) {
            const linhaValor = findLineNumber(context.linesArray, tagValor, context.procLinha - 1);
            context.results.alertas.push({
                linha: linhaValor,
                guia: context.identificadorGuia,
                item: context.seqItem,
                codigo: context.codProc,
                descricao: context.descProc,
                tipo: "Alerta",
                categoria: "fin",
                mensagem: `Valor zerado detectado no item.`,
                targetTag: "valorTotal"
            });
            context.results.categorias.fin++;
        }
    },

    validarSomatoriosGuia(guiaNode, context, calculados, declarados) {
        const checkDivergencia = (tipo, dec, calc, tagBusca) => {
            if (Math.abs(dec - calc) > 0.01) {
                const linhaDivergencia = findLineNumber(context.linesArray, tagBusca, context.numLinhaGuia);
                context.results.erros.push({
                    linha: linhaDivergencia,
                    guia: context.identificadorGuia,
                    item: "-",
                    codigo: "-",
                    descricao: `Resumo - ${tipo}`,
                    tipo: "Erro",
                    categoria: "fin",
                    mensagem: `Divergência financeira: Declarado ${formatMoneyBR(dec)} vs Calculado ${formatMoneyBR(calc)}.`,
                    targetTag: tagBusca
                });
                context.results.categorias.fin++;
            }
        };

        checkDivergencia("valorProcedimentos", declarados.proc, calculados.proc, 'valorProcedimentos');
        checkDivergencia("valorMateriais (03)", declarados.mat, calculados.mat, 'valorMateriais');
        checkDivergencia("valorMedicamentos (02)", declarados.med, calculados.med, 'valorMedicamentos');
        checkDivergencia("valorDiarias (05)", declarados.dia, calculados.dia, 'valorDiarias');
        checkDivergencia("valorTaxasAlugueis (07)", declarados.tax, calculados.tax, 'valorTaxasAlugueis');
        checkDivergencia("valorOPME (08)", declarados.opme, calculados.opme, 'valorOPME');
        checkDivergencia("valorGasesMedicinais (01)", declarados.gas, calculados.gas, 'valorGasesMedicinais');

        const somaCalculadaTotal = calculados.proc + calculados.mat + calculados.med + calculados.dia + calculados.tax + calculados.opme + calculados.gas;
        checkDivergencia("valorTotalGeral", declarados.totalGeral, somaCalculadaTotal, 'valorTotalGeral');

        return somaCalculadaTotal;
    }
};