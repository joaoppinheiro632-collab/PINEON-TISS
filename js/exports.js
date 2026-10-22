import { generateZipBlob } from './zip.js';

// Campos vindos do XML podem começar com =, +, - ou @, o que o Excel/Sheets
// interpreta como início de fórmula (CSV/Formula Injection — ex: um valor
// "=CMD|'/c calc'!A1" no lote pode executar comandos ao abrir o CSV exportado).
// Prefixar com apóstrofo neutraliza a fórmula sem alterar o texto visível.
export function sanitizeCsvField(value) {
    let str = value === null || value === undefined ? '' : String(value);
    if (/^[=+\-@\t\r]/.test(str)) {
        str = "'" + str;
    }
    // Escapa aspas duplas internas dobrando-as, conforme padrão CSV (RFC 4180)
    return str.replace(/"/g, '""');
}

export function exportCSV(validationResults) {
    if (!validationResults.guias.length) {
        alert("Nenhum dado carregado para exportação.");
        return;
    }

    let csv = "Guia Internacao;Tipo;Item;Codigo;Descricao;Linha;Mensagem\n";

    const todos = [...validationResults.erros, ...validationResults.alertas];
    todos.forEach(e => {
        csv += `"${sanitizeCsvField(e.guia)}";"${sanitizeCsvField(e.tipo)}";"${sanitizeCsvField(e.item)}";"${sanitizeCsvField(e.codigo)}";"${sanitizeCsvField(e.descricao)}";${Number(e.linha) || 0};"${sanitizeCsvField(e.mensagem)}"\n`;
    });

    const blob = new Blob(["\ufeff" + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Inconsistencias_Lote_${validationResults.resumoLote.lote || 'SEM_LOTE'}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

export function exportGuiasCSV(validationResults) {
    if (!validationResults || !validationResults.guias.length) {
        alert("Nenhum dado carregado para exportação.");
        return;
    }

    let csv = "Guia;Carteirinha;Senha;Linha;Erros;Alertas;Valor Total;Valor Calculado\n";

    validationResults.guias.forEach(g => {
        csv += `"${sanitizeCsvField(g.guiaPrestador)}";"${sanitizeCsvField(g.carteirinha)}";"${sanitizeCsvField(g.senha)}";${Number(g.linha) || 0};${Number(g.erros) || 0};${Number(g.alertas) || 0};${(Number(g.valorTotal) || 0).toFixed(2).replace('.', ',')};${(Number(g.valorCalculado) || 0).toFixed(2).replace('.', ',')}\n`;
    });

    const blob = new Blob(["\ufeff" + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Guias_Lote_${validationResults.resumoLote.lote || 'SEM_LOTE'}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

export function exportChangelogCSV(entries) {
    if (!entries.length) {
        alert("Nenhuma alteração registrada hoje para exportar.");
        return;
    }

    let csv = "Hora;Lote;Linha;Campo;Antes;Depois\n";

    entries.forEach(e => {
        const hora = new Date(e.dataHora).toLocaleString('pt-BR');
        csv += `"${sanitizeCsvField(hora)}";"${sanitizeCsvField(e.lote)}";${Number(e.linha) || 0};"${sanitizeCsvField(e.campo)}";"${sanitizeCsvField(e.antes)}";"${sanitizeCsvField(e.depois)}"\n`;
    });

    const blob = new Blob(["\ufeff" + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Alteracoes_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

export function exportXML(originalXmlFilename, xmlText) {
    if (!xmlText) {
        alert('Nenhum lote carregado para exportação.');
        return;
    }

    const base = (originalXmlFilename || 'guia.xml').replace(/\.xml$/i, '');
    const blob = new Blob([xmlText], { type: 'application/xml;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${base}_editado.xml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

export async function exportZIP(originalXmlFilename, xmlText, numLote) {
    if (!xmlText) {
        alert('Nenhum lote carregado para exportação.');
        return;
    }

    const blob = await generateZipBlob(originalXmlFilename, xmlText);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Lote_${numLote || 'SEM_LOTE'}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}