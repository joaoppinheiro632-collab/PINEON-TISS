// Testes das regras personalizadas (parte que não depende de DOM).
// Rodar com: npm test   (ou: node --test tests/*.test.js)

import { test } from 'node:test';
import assert from 'node:assert/strict';

// localStorage mínimo, só pra getRegras/atualizarRegra rodarem fora do navegador.
const store = {};
globalThis.localStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
};

const {
    avaliarCondicao, avaliarRegra, getRegras, adicionarRegra, atualizarRegra, removerRegra, descreverRegra,
    parsePrestadores, regraValeParaPrestador, REGEX_NOME_TAG, limparNomeTag
} = await import('../js/regrasPersonalizadas.js');

test('igualCampo / diferenteCampo comparam dois campos da guia', () => {
    assert.equal(avaliarCondicao('15463716', 'diferenteCampo', 'numeroGuiaOperadora', '15463696'), true);
    assert.equal(avaliarCondicao('15463716', 'diferenteCampo', 'numeroGuiaOperadora', '15463716'), false);
    assert.equal(avaliarCondicao('10', 'igualCampo', 'outro', ' 10 '), true);
});

test('condição entre campos não dispara se um dos campos não existe na guia', () => {
    assert.equal(avaliarCondicao(null, 'diferenteCampo', 'x', '1'), false);
    assert.equal(avaliarCondicao('1', 'diferenteCampo', 'x', null), false);
});

test('avaliarRegra lê a tag citada em "valor" nas condições entre campos', () => {
    const campos = { numeroGuiaSolicitacaoInternacao: '1', numeroGuiaOperadora: '2' };
    const lerCampo = c => (c in campos ? campos[c] : null);
    const regra = {
        combinador: 'E',
        condicoes: [{ campo: 'numeroGuiaSolicitacaoInternacao', condicao: 'diferenteCampo', valor: 'numeroGuiaOperadora' }]
    };
    assert.equal(avaliarRegra(regra, lerCampo), true);
    campos.numeroGuiaOperadora = '1';
    assert.equal(avaliarRegra(regra, lerCampo), false);
});

test('tag ausente só satisfaz "está vazio" (comportamento anterior preservado)', () => {
    assert.equal(avaliarCondicao(null, 'vazio', ''), true);
    assert.equal(avaliarCondicao(null, 'diferente', '4'), false);
});

test('atualizarRegra troca o conteúdo mantendo o id e a posição', () => {
    store.pinware_regras_personalizadas = '[]';
    adicionarRegra({ combinador: 'E', condicoes: [{ campo: 'a', condicao: 'igual', valor: '1' }], severidade: 'Erro', mensagem: 'primeira' });
    adicionarRegra({ combinador: 'E', condicoes: [{ campo: 'b', condicao: 'igual', valor: '2' }], severidade: 'Erro', mensagem: 'segunda' });
    const [r1] = getRegras();

    atualizarRegra(r1.id, {
        combinador: 'OU',
        condicoes: [{ campo: 'c', condicao: 'vazio', valor: '' }],
        severidade: 'Alerta',
        mensagem: 'editada',
        campoCorrigir: 'c',
        valorCorrigir: null,
        origemCorrigir: 'd'
    });

    const regras = getRegras();
    assert.equal(regras.length, 2);
    assert.equal(regras[0].id, r1.id);
    assert.equal(regras[0].mensagem, 'editada');
    assert.equal(regras[0].origemCorrigir, 'd');
    assert.equal(regras[1].mensagem, 'segunda');
    assert.match(descreverRegra(regras[0]), /c está vazio/);

    removerRegra(r1.id);
    assert.equal(getRegras().length, 1);
});

test('atualizarRegra com id inexistente não altera nada', () => {
    store.pinware_regras_personalizadas = JSON.stringify([
        { id: 'x', combinador: 'E', condicoes: [{ campo: 'a', condicao: 'igual', valor: '1' }], severidade: 'Erro', mensagem: 'm' }
    ]);
    atualizarRegra('nao-existe', { combinador: 'E', condicoes: [{ campo: 'z', condicao: 'vazio', valor: '' }], severidade: 'Erro' });
    assert.equal(getRegras()[0].mensagem, 'm');
});

test('regras salvas na v3.0 (condição única na raiz) continuam sendo lidas', () => {
    store.pinware_regras_personalizadas = JSON.stringify([
        { id: 'old', campo: 'tipoFaturamento', condicao: 'igual', valor: '4', severidade: 'Erro' }
    ]);
    const [r] = getRegras();
    assert.deepEqual(r.condicoes, [{ campo: 'tipoFaturamento', condicao: 'igual', valor: '4' }]);
});

test('parsePrestadores aceita vírgula, ponto e vírgula e espaços, sem repetir', () => {
    assert.deepEqual(parsePrestadores('650, 712;  905 650'), ['650', '712', '905']);
    assert.deepEqual(parsePrestadores(''), []);
    assert.deepEqual(parsePrestadores(null), []);
});

test('regra sem prestadores vale pra todos; com prestadores, só pra eles', () => {
    assert.equal(regraValeParaPrestador({ prestadores: [] }, '650'), true);
    assert.equal(regraValeParaPrestador({}, '650'), true);
    assert.equal(regraValeParaPrestador({ prestadores: ['650', '712'] }, '650'), true);
    assert.equal(regraValeParaPrestador({ prestadores: ['650', '712'] }, ' 712 '), true);
    assert.equal(regraValeParaPrestador({ prestadores: ['650'] }, '999'), false);
    // lote sem código de prestador: regra restrita não dispara
    assert.equal(regraValeParaPrestador({ prestadores: ['650'] }, ''), false);
    assert.equal(regraValeParaPrestador({ prestadores: ['650'] }, null), false);
});

test('regras antigas (sem prestadores) são lidas como "vale pra todos"', () => {
    store.pinware_regras_personalizadas = JSON.stringify([
        { id: 'a', combinador: 'E', condicoes: [{ campo: 'x', condicao: 'vazio', valor: '' }], severidade: 'Erro' }
    ]);
    assert.deepEqual(getRegras()[0].prestadores, []);
});

test('"começa com" casa só o início do valor (diferente de "contém")', () => {
    assert.equal(avaliarCondicao('19000001', 'comecaCom', '19'), true);
    assert.equal(avaliarCondicao('70190001', 'comecaCom', '19'), false);
    assert.equal(avaliarCondicao('70190001', 'contem', '19'), true);
    assert.equal(avaliarCondicao('19000001', 'comecaCom', ''), false);
    assert.equal(avaliarCondicao(null, 'comecaCom', '19'), false);
});

test('regra por item: nível "item" é preservado e o padrão é "guia"', () => {
    store.pinware_regras_personalizadas = JSON.stringify([
        { id: 'i', combinador: 'E', condicoes: [{ campo: 'codigoProcedimento', condicao: 'comecaCom', valor: '19' }], severidade: 'Erro', nivel: 'item' },
        { id: 'g', combinador: 'E', condicoes: [{ campo: 'senha', condicao: 'vazio', valor: '' }], severidade: 'Erro' },
        { id: 'x', combinador: 'E', condicoes: [{ campo: 'senha', condicao: 'vazio', valor: '' }], severidade: 'Erro', nivel: 'qualquer-coisa' }
    ]);
    const [i, g, x] = getRegras();
    assert.equal(i.nivel, 'item');
    assert.equal(g.nivel, 'guia');
    assert.equal(x.nivel, 'guia');
});

test('comparações de texto ignoram maiúsculas/minúsculas ("n" casa com "N")', () => {
    assert.equal(avaliarCondicao('N', 'igual', 'n'), true);
    assert.equal(avaliarCondicao('n', 'igual', 'N'), true);
    assert.equal(avaliarCondicao('N', 'diferente', 'n'), false);
    assert.equal(avaliarCondicao('Hospital Central', 'contem', 'central'), true);
    assert.equal(avaliarCondicao('ABC123', 'comecaCom', 'abc'), true);
    assert.equal(avaliarCondicao('N', 'diferenteCampo', 'x', 'n'), false);
    assert.equal(avaliarCondicao('721', 'igual', 'N'), false);
});

test('campo aceita caminho "pai/filho" e prefixo ans: em cada parte', () => {
    assert.equal(REGEX_NOME_TAG.test('codigoPrestadorNaOperadora'), true);
    assert.equal(REGEX_NOME_TAG.test('contratadoExecutante/codigoPrestadorNaOperadora'), true);
    assert.equal(REGEX_NOME_TAG.test('a//b'), false);
    assert.equal(REGEX_NOME_TAG.test('/a'), false);
    assert.equal(REGEX_NOME_TAG.test('a/'), false);
    assert.equal(limparNomeTag(' ans:dadosExecutante / ans:codigoPrestadorNaOperadora '), 'dadosExecutante/codigoPrestadorNaOperadora');
    assert.equal(limparNomeTag('ans:motivoEncerramento'), 'motivoEncerramento');
});

test('nível "ocorrencia" é preservado; valores desconhecidos viram "guia"', () => {
    store.pinware_regras_personalizadas = JSON.stringify([
        { id: 'o', combinador: 'E', condicoes: [{ campo: 'x', condicao: 'vazio', valor: '' }], severidade: 'Erro', nivel: 'ocorrencia' },
        { id: 'z', combinador: 'E', condicoes: [{ campo: 'x', condicao: 'vazio', valor: '' }], severidade: 'Erro', nivel: 'lote' }
    ]);
    const [o, z] = getRegras();
    assert.equal(o.nivel, 'ocorrencia');
    assert.equal(z.nivel, 'guia');
});
