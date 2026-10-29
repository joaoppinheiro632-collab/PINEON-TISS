// Testes da correção automática por linhas (js/correcao.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { corrigirLinhas } from '../js/correcao.js';

const xml = [
    '<ans:guia>',                                                                   // 1
    '<ans:contratadoSolicitante><ans:codigoPrestadorNaOperadora>721</ans:codigoPrestadorNaOperadora></ans:contratadoSolicitante>', // 2
    '<ans:contratadoExecutante><ans:codigoPrestadorNaOperadora>N</ans:codigoPrestadorNaOperadora></ans:contratadoExecutante>',     // 3
    '<ans:senha>9</ans:senha>',                                                     // 4
    '</ans:guia>',                                                                  // 5
    '<ans:guia>',                                                                   // 6
    '<ans:senha>55</ans:senha>',                                                    // 7
    '</ans:guia>'                                                                   // 8
];

test('corrige só dentro da faixa e devolve o índice da linha alterada', () => {
    const ls = [...xml];
    const i = corrigirLinhas(ls, { tag: 'codigoPrestadorNaOperadora', valorNovo: '721', inicioGuia: 3, fimGuia: 3 });
    assert.equal(i, 2);
    assert.match(ls[2], />721</);
    assert.match(ls[1], />721</);           // solicitante não foi tocado
});

test('a faixa de uma guia nunca alcança a guia vizinha', () => {
    const ls = [...xml];
    // guia 1 (linhas 1-5) sem a tag "tipo": não pode mexer na guia 2
    assert.equal(corrigirLinhas(ls, { tag: 'tipo', valorNovo: 'x', inicioGuia: 1, fimGuia: 5 }), -1);
    // senha da guia 2 só é achada na faixa da guia 2
    const i = corrigirLinhas(ls, { tag: 'senha', valorNovo: '0', inicioGuia: 6, fimGuia: 8 });
    assert.equal(i, 6);
    assert.match(ls[3], />9</);             // senha da guia 1 intacta
});

test('valor com caracteres especiais é escapado e "$&" não vira padrão', () => {
    const ls = ['<ans:nome>velho</ans:nome>'];
    corrigirLinhas(ls, { tag: 'nome', valorNovo: 'A & B <$&>', inicioGuia: 1, fimGuia: 1 });
    assert.equal(ls[0], '<ans:nome>A &amp; B &lt;$&amp;&gt;</ans:nome>');
});

test('aceita tag sem prefixo de namespace', () => {
    const ls = ['<senha>1</senha>'];
    assert.equal(corrigirLinhas(ls, { tag: 'senha', valorNovo: '2', inicioGuia: 1, fimGuia: 1 }), 0);
    assert.equal(ls[0], '<senha>2</senha>');
});

test('usa autoFix.campo quando não há tag separada (compatibilidade)', () => {
    const ls = ['<ans:senha>1</ans:senha>'];
    assert.equal(corrigirLinhas(ls, { campo: 'senha', valorNovo: '2', inicioGuia: 1, fimGuia: 1 }), 0);
});
