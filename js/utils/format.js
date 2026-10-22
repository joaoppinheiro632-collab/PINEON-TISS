// Formatação para EXIBIÇÃO apenas. Não faz parsing nem altera o valor
// internamente — os números já chegam como Number (parseFloat do valor do
// XML, que segue o padrão TISS: ponto decimal, sem separador de milhar).
// Esta função só decide como esse número aparece na tela para o usuário.
export function formatMoneyBR(valor) {
    const num = Number(valor) || 0;
    return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
