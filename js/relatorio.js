// Resumo do Dia / Relatório de Produção.
//
// Dados 100% AUTOMÁTICOS, tirados do que o próprio PINEON processou
// hoje (histórico de transmissões — já zera sozinho à meia-noite, então
// getHistorico() aqui já é "só hoje", sem precisar filtrar de novo). A
// tabela "Produção Realizada" é toda derivada disso, uma linha por
// prestador — nada de edição manual aqui, só a observação livre é do
// usuário.
const STORAGE_KEY_NOTA = 'pinware_relatorio_nota';
const STORAGE_KEY_NOTA_DIA = 'pinware_relatorio_nota_dia';

function getDiaAtual() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Agrega o histórico de transmissões de hoje. Um mesmo lote pode ter sido
// enviado mais de uma vez — pra guias/valor/prestador, a versão mais
// recente é quem vale (reflete o lote como está agora: se foi enviado por
// R$ 10.000 e depois por R$ 9.000, o certo é R$ 9.000; se depois for R$
// 12.000, o certo passa a ser R$ 12.000). Mas pra "está corrigido" não dá
// pra usar só a mais recente: reenviar o MESMO lote 2 vezes ou mais já é
// evidência de que algo foi corrigido, mesmo que o Validador não tenha
// marcado nenhum erro/alerta — por isso qtdEnvios é rastreado à parte, e
// enviar o mesmo lote 10 vezes ainda conta só 1 correção (é um Map por
// lote, nunca soma duas vezes o mesmo).
export function getResumoAutomatico(historico) {
    const porLote = new Map();
    historico.forEach(r => {
        const atual = porLote.get(r.lote);
        if (!atual) {
            porLote.set(r.lote, {
                ...r,
                guiasComInconsistenciaPico: r.guiasComInconsistencia || 0,
                qtdEnvios: 1
            });
            return;
        }
        const maisRecente = r.dataHora > atual.dataHora ? r : atual;
        porLote.set(r.lote, {
            ...maisRecente,
            guiasComInconsistenciaPico: Math.max(atual.guiasComInconsistenciaPico, r.guiasComInconsistencia || 0),
            qtdEnvios: atual.qtdEnvios + 1
        });
    });
    const registros = [...porLote.values()];

    const totalGuias = registros.reduce((acc, r) => acc + (r.guias || 0), 0);

    // Um lote "está corrigido" se o Validador pegou alguma inconsistência
    // em algum momento OU se foi reenviado (2+ envios). Nesse caso, credita
    // TODAS as guias daquele lote — não dá pra saber com certeza qual conta
    // específica mudou entre um envio e outro, então conta o lote inteiro.
    const totalGuiasComInconsistencia = registros.reduce((acc, r) => {
        const loteCorrigido = r.qtdEnvios > 1 || r.guiasComInconsistenciaPico > 0;
        return acc + (loteCorrigido ? (r.guias || 0) : 0);
    }, 0);

    const valorProduzido = registros.reduce((acc, r) => acc + (r.valor || 0), 0);
    const percentualPrevenido = totalGuias > 0
        ? Math.round((totalGuiasComInconsistencia / totalGuias) * 100)
        : 0;

    // Agrupamento por prestador — vira a base da tabela "Produção
    // Realizada", uma linha por prestador (código igual ao que já aparece
    // no Histórico de Transmissões), com quantidade de contas e valor.
    const porPrestadorMapa = new Map();
    registros.forEach(r => {
        const chave = r.prestador || 'N/I';
        const atual = porPrestadorMapa.get(chave) || { prestador: chave, quantidade: 0, valor: 0 };
        atual.quantidade += r.guias || 0;
        atual.valor += r.valor || 0;
        porPrestadorMapa.set(chave, atual);
    });

    return {
        registros,
        totalGuias,
        totalGuiasComInconsistencia,
        valorProduzido,
        percentualPrevenido,
        porPrestador: [...porPrestadorMapa.values()]
    };
}

function checarResetDiarioNota() {
    const diaSalvo = localStorage.getItem(STORAGE_KEY_NOTA_DIA);
    const diaAtual = getDiaAtual();
    if (diaSalvo !== diaAtual) {
        localStorage.removeItem(STORAGE_KEY_NOTA);
        localStorage.setItem(STORAGE_KEY_NOTA_DIA, diaAtual);
    }
}

export function getNotaDoDia() {
    checarResetDiarioNota();
    return localStorage.getItem(STORAGE_KEY_NOTA) || '';
}

export function salvarNotaDoDia(texto) {
    checarResetDiarioNota();
    localStorage.setItem(STORAGE_KEY_NOTA, texto || '');
}
