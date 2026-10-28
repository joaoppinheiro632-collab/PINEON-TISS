export function getElementsByLocalName(parent, localName) {
    if (!parent) return [];
    return Array.from(parent.getElementsByTagName("*")).filter(
        node => node.localName === localName
    );
}

export function getTagVal(parent, tagName) {
    const el = getElementsByLocalName(parent, tagName)[0];
    return el ? el.textContent.trim() : '';
}

export function findLineNumber(linesArray, searchText, startFrom = 0) {
    if (!searchText) return startFrom || 1;
    for (let i = startFrom; i < linesArray.length; i++) {
        if (linesArray[i].includes(searchText)) {
            return i + 1;
        }
    }
    return startFrom || 1;
}