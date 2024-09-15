// SETUP: Create search index
let iemsData = {};
let iemsFR = Array();
let index = window.FlexSearch.Index({
  tokenize: "forward",
  charset: "latin:simple",
});

function removeChildren(node) {
  if (node.hasChildNodes()) {
    node.innerHTML = "";
  }
}

async function decompressBlob(blob) {
  let ds = new DecompressionStream("gzip");
  let decompressedStream = blob.stream().pipeThrough(ds);
  return await new Response(decompressedStream).arrayBuffer();
}

async function changeSourceData(dataPath) {
  document.getElementById("search-iem").value = "Loading...";

  iemsData = await fetch(dataPath)
    .then((response) => response.blob())
    .then((blob) => decompressBlob(blob))
    .then((buffer) => CBOR.decode(new Uint8Array(buffer)));

  // Reset index
  iemsFR = Array();
  index = window.FlexSearch.Index({
    tokenize: "forward",
    charset: "latin:simple",
  });
  for (var i in iemsData.name) {
    index.add(i, iemsData.name[i]);
    // Make a flat freq resp in iemsFR
    let freqResp = iemsData.response[i];
    iemsFR.push(...freqResp.flat());
  }

  // Clear search bar and suggestions
  document.getElementById("search-iem").value = "";
  removeChildren(document.getElementById("suggestions"));
  removeChildren(document.querySelector("#dataTable tbody"));
}

function showSuggestions(value) {
  if (value.length === 0)
    removeChildren(document.getElementById("suggestions"));
  const start = performance.now();
  const suggestionsDiv = document.getElementById("suggestions");
  if (value.length === 0) {
    return;
  }

  const fragment = [];
  const suggestions = index.search(value, 20);
  suggestions.forEach((suggestion) => {
    suggestion = iemsData.name[suggestion];
    const suggestionDiv = document.createElement("div");
    suggestionDiv.textContent = suggestion;
    suggestionDiv.onclick = () => {
      document.getElementById("search-iem").value = suggestion;
      removeChildren(suggestionsDiv);
      findSimilarIEM(suggestion);
    };
    fragment.push(suggestionDiv);
  });
  suggestionsDiv.replaceChildren(...fragment);
  console.log(
    "showSuggestions time taken: " + (performance.now() - start) + "ms"
  );
}

function clearSearch() {
  document.getElementById("search-iem").value = "";
  removeChildren(document.getElementById("suggestions"));
}

// Table functions
let allData = [];
const itemsPerPage = 10;
let currentPage = 1;
let currentSort = { column: "prefScore", direction: "desc" };

let squigs = {
  "data/super.cbor.gz": "https://squig.link?x=0",
  "data/pw.cbor.gz": "https://pw.squig.link?x=0",
  "data/precog.cbor.gz": "https://precog.squig.link?x=0",
  "data/crinacle_711.cbor.gz":
    "https://crinacle.com/graphs/iems/graphtool/?tool=711",
  "data/crinacle_4620.cbor.gz":
    "https://crinacle.com/graphs/iems/graphtool/?tool=4620",
  "data/hbb.cbor.gz": "https://hbb.squig.link?x=0",
  "data/timmyv.cbor.gz": "https://timmyv.squig.link?x=0",
  "data/antdroid.cbor.gz": "https://iems.audiodiscourse.com?x=0",
};

function renderTable(data) {
  const tableBody = document.querySelector("#dataTable tbody");

  const start = (currentPage - 1) * itemsPerPage;
  const end = start + itemsPerPage;
  const paginatedData = data.slice(start, end);

  // Create url for squig.link
  let source = document.getElementById("data-source").value;
  let squigUrl = squigs[source];

  // Get current IEM name
  var tableBodyInnerHTML = "";
  let selectedIEM = document.getElementById("search-iem").value;
  let selectedIdx = iemsData.name.indexOf(selectedIEM);
  let selectedFile = iemsData.paths[selectedIdx].replaceAll(" ", "_");
  paginatedData.forEach((item) => {
    let squigLink = `<a href="${squigUrl}&share=${selectedFile},${item.path.replaceAll(
      " ",
      "_"
    )}" style="text-decoration: none; color: inherit;" target="_blank">${
      item.name
    }</a>`;

    const row = `<tr>
                <td>${squigLink}</td>
                <td>${item.stdErr}</td>
                <td>${item.meanErr}</td>
                <td>${item.prefScore}</td>
            </tr>`;
    tableBodyInnerHTML += row;
  });
  tableBody.innerHTML = tableBodyInnerHTML;

  renderPagination();
  updateSortIcons();
}

function renderPagination() {
  const pageCount = Math.ceil(allData.length / itemsPerPage);
  const paginationElement = document.getElementById("pagination");
  removeChildren(paginationElement);

  // Previous button
  const prevButton = createButton("Previous", () => {
    if (currentPage > 1) {
      currentPage--;
      renderTable(allData);
    }
  });
  prevButton.disabled = currentPage === 1;
  paginationElement.appendChild(prevButton);

  // Page numbers
  const startPage = Math.max(1, currentPage - 2);
  const endPage = Math.min(pageCount, startPage + 4);

  for (let i = startPage; i <= endPage; i++) {
    const button = createButton(i, () => {
      currentPage = i;
      renderTable(allData);
    });
    button.disabled = i === currentPage;
    paginationElement.appendChild(button);
  }

  // Next button
  const nextButton = createButton("Next", () => {
    if (currentPage < pageCount) {
      currentPage++;
      renderTable(allData);
    }
  });
  nextButton.disabled = currentPage === pageCount;
  paginationElement.appendChild(nextButton);
}

function createButton(text, onClick) {
  const button = document.createElement("button");
  button.innerText = text;
  button.classList.add("pageButton");
  button.addEventListener("click", onClick);
  return button;
}

function searchTable() {
  const searchTerm = document.getElementById("searchBox").value.toLowerCase();
  let filteredData = allData.filter((item) =>
    item.name.toLowerCase().includes(searchTerm)
  );
  currentPage = 1;
  renderTable(filteredData);
}

function bitAbs(x) {
  const mask = x >> 31;
  return (x ^ mask) - mask;
}

function findSimilarIEM(iemName) {
  const start = performance.now();
  const selectedIdx = iemsData.name.indexOf(iemName);
  const curFreq = iemsData.response[selectedIdx];

  const iemsCnt = iemsData.name.length;
  const freqDims = curFreq.length;
  const freqDimsmin = freqDims - 1;
  const sqrSum = new Float32Array(iemsCnt);
  const sumnoAbs = new Float32Array(iemsCnt);
  const sumAll = new Float32Array(iemsCnt);

  let j = 0;
  const mathAbs = Math.abs;
  const iemsFRLen = iemsFR.length;

  // There might be a one off error here somewhere ...
  for (let i = 0; i < iemsFRLen + freqDimsmin; i += freqDimsmin) {
    const splError0 = iemsFR[i + 0] - curFreq[(i + 0) & freqDimsmin];
    const splError1 = iemsFR[i + 1] - curFreq[(i + 1) & freqDimsmin];
    const splError2 = iemsFR[i + 2] - curFreq[(i + 2) & freqDimsmin];
    const splError3 = iemsFR[i + 3] - curFreq[(i + 3) & freqDimsmin];
    const splError4 = iemsFR[i + 4] - curFreq[(i + 4) & freqDimsmin];
    const splError5 = iemsFR[i + 5] - curFreq[(i + 5) & freqDimsmin];
    const splError6 = iemsFR[i + 6] - curFreq[(i + 6) & freqDimsmin];
    const splError7 = iemsFR[i + 7] - curFreq[(i + 7) & freqDimsmin];
    const splError8 = iemsFR[i + 8] - curFreq[(i + 8) & freqDimsmin];
    const splError9 = iemsFR[i + 9] - curFreq[(i + 9) & freqDimsmin];
    const splError10 = iemsFR[i + 10] - curFreq[(i + 10) & freqDimsmin];
    const splError11 = iemsFR[i + 11] - curFreq[(i + 11) & freqDimsmin];
    const splError12 = iemsFR[i + 12] - curFreq[(i + 12) & freqDimsmin];
    const splError13 = iemsFR[i + 13] - curFreq[(i + 13) & freqDimsmin];
    const splError14 = iemsFR[i + 14] - curFreq[(i + 14) & freqDimsmin];
    const splError15 = iemsFR[i + 15] - curFreq[(i + 15) & freqDimsmin];
    const splError16 = iemsFR[i + 16] - curFreq[(i + 16) & freqDimsmin];
    const splError17 = iemsFR[i + 17] - curFreq[(i + 17) & freqDimsmin];
    const splError18 = iemsFR[i + 18] - curFreq[(i + 18) & freqDimsmin];
    const splError19 = iemsFR[i + 19] - curFreq[(i + 19) & freqDimsmin];
    const splError20 = iemsFR[i + 20] - curFreq[(i + 20) & freqDimsmin];
    const splError21 = iemsFR[i + 21] - curFreq[(i + 21) & freqDimsmin];
    const splError22 = iemsFR[i + 22] - curFreq[(i + 22) & freqDimsmin];
    const splError23 = iemsFR[i + 23] - curFreq[(i + 23) & freqDimsmin];
    const splError24 = iemsFR[i + 24] - curFreq[(i + 24) & freqDimsmin];
    const splError25 = iemsFR[i + 25] - curFreq[(i + 25) & freqDimsmin];
    const splError26 = iemsFR[i + 26] - curFreq[(i + 26) & freqDimsmin];
    const splError27 = iemsFR[i + 27] - curFreq[(i + 27) & freqDimsmin];
    const splError28 = iemsFR[i + 28] - curFreq[(i + 28) & freqDimsmin];
    const splError29 = iemsFR[i + 29] - curFreq[(i + 29) & freqDimsmin];
    const splError30 = iemsFR[i + 30] - curFreq[(i + 30) & freqDimsmin];
    const splError31 = iemsFR[i + 31] - curFreq[(i + 31) & freqDimsmin];
    const splError32 = iemsFR[i + 32] - curFreq[(i + 32) & freqDimsmin];
    const splError33 = iemsFR[i + 33] - curFreq[(i + 33) & freqDimsmin];
    const splError34 = iemsFR[i + 34] - curFreq[(i + 34) & freqDimsmin];
    const splError35 = iemsFR[i + 35] - curFreq[(i + 35) & freqDimsmin];
    const splError36 = iemsFR[i + 36] - curFreq[(i + 36) & freqDimsmin];
    const splError37 = iemsFR[i + 37] - curFreq[(i + 37) & freqDimsmin];
    const splError38 = iemsFR[i + 38] - curFreq[(i + 38) & freqDimsmin];
    const splError39 = iemsFR[i + 39] - curFreq[(i + 39) & freqDimsmin];
    const splError40 = iemsFR[i + 40] - curFreq[(i + 40) & freqDimsmin];
    const splError41 = iemsFR[i + 41] - curFreq[(i + 41) & freqDimsmin];
    const splError42 = iemsFR[i + 42] - curFreq[(i + 42) & freqDimsmin];
    const splError43 = iemsFR[i + 43] - curFreq[(i + 43) & freqDimsmin];
    const splError44 = iemsFR[i + 44] - curFreq[(i + 44) & freqDimsmin];
    const splError45 = iemsFR[i + 45] - curFreq[(i + 45) & freqDimsmin];
    const splError46 = iemsFR[i + 46] - curFreq[(i + 46) & freqDimsmin];
    const splError47 = iemsFR[i + 47] - curFreq[(i + 47) & freqDimsmin];
    const splError48 = iemsFR[i + 48] - curFreq[(i + 48) & freqDimsmin];
    const splError49 = iemsFR[i + 49] - curFreq[(i + 49) & freqDimsmin];
    const splError50 = iemsFR[i + 50] - curFreq[(i + 50) & freqDimsmin];
    const splError51 = iemsFR[i + 51] - curFreq[(i + 51) & freqDimsmin];
    const splError52 = iemsFR[i + 52] - curFreq[(i + 52) & freqDimsmin];
    const splError53 = iemsFR[i + 53] - curFreq[(i + 53) & freqDimsmin];
    const splError54 = iemsFR[i + 54] - curFreq[(i + 54) & freqDimsmin];
    const splError55 = iemsFR[i + 55] - curFreq[(i + 55) & freqDimsmin];
    const splError56 = iemsFR[i + 56] - curFreq[(i + 56) & freqDimsmin];
    const splError57 = iemsFR[i + 57] - curFreq[(i + 57) & freqDimsmin];
    const splError58 = iemsFR[i + 58] - curFreq[(i + 58) & freqDimsmin];
    const splError59 = iemsFR[i + 59] - curFreq[(i + 59) & freqDimsmin];
    const splError60 = iemsFR[i + 60] - curFreq[(i + 60) & freqDimsmin];
    const splError61 = iemsFR[i + 61] - curFreq[(i + 61) & freqDimsmin];
    const splError62 = iemsFR[i + 62] - curFreq[(i + 62) & freqDimsmin];
    const splError63 = iemsFR[i + 63] - curFreq[(i + 63) & freqDimsmin];
    const splError64 = iemsFR[i + 64] - curFreq[(i + 64) & freqDimsmin];
    const splError65 = iemsFR[i + 65] - curFreq[(i + 65) & freqDimsmin];
    const splError66 = iemsFR[i + 66] - curFreq[(i + 66) & freqDimsmin];
    const splError67 = iemsFR[i + 67] - curFreq[(i + 67) & freqDimsmin];
    const splError68 = iemsFR[i + 68] - curFreq[(i + 68) & freqDimsmin];
    const splError69 = iemsFR[i + 69] - curFreq[(i + 69) & freqDimsmin];
    const splError70 = iemsFR[i + 70] - curFreq[(i + 70) & freqDimsmin];
    const splError71 = iemsFR[i + 71] - curFreq[(i + 71) & freqDimsmin];
    const splError72 = iemsFR[i + 72] - curFreq[(i + 72) & freqDimsmin];
    const splError73 = iemsFR[i + 73] - curFreq[(i + 73) & freqDimsmin];
    const splError74 = iemsFR[i + 74] - curFreq[(i + 74) & freqDimsmin];
    const splError75 = iemsFR[i + 75] - curFreq[(i + 75) & freqDimsmin];
    const splError76 = iemsFR[i + 76] - curFreq[(i + 76) & freqDimsmin];
    const splError77 = iemsFR[i + 77] - curFreq[(i + 77) & freqDimsmin];
    const splError78 = iemsFR[i + 78] - curFreq[(i + 78) & freqDimsmin];
    const splError79 = iemsFR[i + 79] - curFreq[(i + 79) & freqDimsmin];
    const splError80 = iemsFR[i + 80] - curFreq[(i + 80) & freqDimsmin];
    const splError81 = iemsFR[i + 81] - curFreq[(i + 81) & freqDimsmin];
    const splError82 = iemsFR[i + 82] - curFreq[(i + 82) & freqDimsmin];
    const splError83 = iemsFR[i + 83] - curFreq[(i + 83) & freqDimsmin];
    const splError84 = iemsFR[i + 84] - curFreq[(i + 84) & freqDimsmin];
    const splError85 = iemsFR[i + 85] - curFreq[(i + 85) & freqDimsmin];
    const splError86 = iemsFR[i + 86] - curFreq[(i + 86) & freqDimsmin];
    const splError87 = iemsFR[i + 87] - curFreq[(i + 87) & freqDimsmin];
    const splError88 = iemsFR[i + 88] - curFreq[(i + 88) & freqDimsmin];
    const splError89 = iemsFR[i + 89] - curFreq[(i + 89) & freqDimsmin];
    const splError90 = iemsFR[i + 90] - curFreq[(i + 90) & freqDimsmin];
    const splError91 = iemsFR[i + 91] - curFreq[(i + 91) & freqDimsmin];
    const splError92 = iemsFR[i + 92] - curFreq[(i + 92) & freqDimsmin];
    const splError93 = iemsFR[i + 93] - curFreq[(i + 93) & freqDimsmin];
    const splError94 = iemsFR[i + 94] - curFreq[(i + 94) & freqDimsmin];
    const splError95 = iemsFR[i + 95] - curFreq[(i + 95) & freqDimsmin];
    const splError96 = iemsFR[i + 96] - curFreq[(i + 96) & freqDimsmin];
    const splError97 = iemsFR[i + 97] - curFreq[(i + 97) & freqDimsmin];
    const splError98 = iemsFR[i + 98] - curFreq[(i + 98) & freqDimsmin];
    const splError99 = iemsFR[i + 99] - curFreq[(i + 99) & freqDimsmin];
    const splError100 = iemsFR[i + 100] - curFreq[(i + 100) & freqDimsmin];
    const splError101 = iemsFR[i + 101] - curFreq[(i + 101) & freqDimsmin];
    const splError102 = iemsFR[i + 102] - curFreq[(i + 102) & freqDimsmin];
    const splError103 = iemsFR[i + 103] - curFreq[(i + 103) & freqDimsmin];
    const splError104 = iemsFR[i + 104] - curFreq[(i + 104) & freqDimsmin];
    const splError105 = iemsFR[i + 105] - curFreq[(i + 105) & freqDimsmin];
    const splError106 = iemsFR[i + 106] - curFreq[(i + 106) & freqDimsmin];
    const splError107 = iemsFR[i + 107] - curFreq[(i + 107) & freqDimsmin];
    const splError108 = iemsFR[i + 108] - curFreq[(i + 108) & freqDimsmin];
    const splError109 = iemsFR[i + 109] - curFreq[(i + 109) & freqDimsmin];
    const splError110 = iemsFR[i + 110] - curFreq[(i + 110) & freqDimsmin];
    const splError111 = iemsFR[i + 111] - curFreq[(i + 111) & freqDimsmin];
    const splError112 = iemsFR[i + 112] - curFreq[(i + 112) & freqDimsmin];
    const splError113 = iemsFR[i + 113] - curFreq[(i + 113) & freqDimsmin];
    const splError114 = iemsFR[i + 114] - curFreq[(i + 114) & freqDimsmin];
    const splError115 = iemsFR[i + 115] - curFreq[(i + 115) & freqDimsmin];
    const splError116 = iemsFR[i + 116] - curFreq[(i + 116) & freqDimsmin];
    const splError117 = iemsFR[i + 117] - curFreq[(i + 117) & freqDimsmin];
    const splError118 = iemsFR[i + 118] - curFreq[(i + 118) & freqDimsmin];
    const splError119 = iemsFR[i + 119] - curFreq[(i + 119) & freqDimsmin];
    const splError120 = iemsFR[i + 120] - curFreq[(i + 120) & freqDimsmin];
    const splError121 = iemsFR[i + 121] - curFreq[(i + 121) & freqDimsmin];
    const splError122 = iemsFR[i + 122] - curFreq[(i + 122) & freqDimsmin];
    const splError123 = iemsFR[i + 123] - curFreq[(i + 123) & freqDimsmin];
    const splError124 = iemsFR[i + 124] - curFreq[(i + 124) & freqDimsmin];
    const splError125 = iemsFR[i + 125] - curFreq[(i + 125) & freqDimsmin];
    const splError126 = iemsFR[i + 126] - curFreq[(i + 126) & freqDimsmin];
    const splError127 = iemsFR[i + 127] - curFreq[(i + 127) & freqDimsmin];
    const splError128 = iemsFR[i + 128] - curFreq[(i + 128) & freqDimsmin];
    const splError129 = iemsFR[i + 129] - curFreq[(i + 129) & freqDimsmin];
    const splError130 = iemsFR[i + 130] - curFreq[(i + 130) & freqDimsmin];
    const splError131 = iemsFR[i + 131] - curFreq[(i + 131) & freqDimsmin];
    const splError132 = iemsFR[i + 132] - curFreq[(i + 132) & freqDimsmin];
    const splError133 = iemsFR[i + 133] - curFreq[(i + 133) & freqDimsmin];
    const splError134 = iemsFR[i + 134] - curFreq[(i + 134) & freqDimsmin];
    const splError135 = iemsFR[i + 135] - curFreq[(i + 135) & freqDimsmin];
    const splError136 = iemsFR[i + 136] - curFreq[(i + 136) & freqDimsmin];
    const splError137 = iemsFR[i + 137] - curFreq[(i + 137) & freqDimsmin];
    const splError138 = iemsFR[i + 138] - curFreq[(i + 138) & freqDimsmin];
    const splError139 = iemsFR[i + 139] - curFreq[(i + 139) & freqDimsmin];
    const splError140 = iemsFR[i + 140] - curFreq[(i + 140) & freqDimsmin];
    const splError141 = iemsFR[i + 141] - curFreq[(i + 141) & freqDimsmin];
    const splError142 = iemsFR[i + 142] - curFreq[(i + 142) & freqDimsmin];
    const splError143 = iemsFR[i + 143] - curFreq[(i + 143) & freqDimsmin];
    const splError144 = iemsFR[i + 144] - curFreq[(i + 144) & freqDimsmin];
    const splError145 = iemsFR[i + 145] - curFreq[(i + 145) & freqDimsmin];
    const splError146 = iemsFR[i + 146] - curFreq[(i + 146) & freqDimsmin];
    const splError147 = iemsFR[i + 147] - curFreq[(i + 147) & freqDimsmin];
    const splError148 = iemsFR[i + 148] - curFreq[(i + 148) & freqDimsmin];
    const splError149 = iemsFR[i + 149] - curFreq[(i + 149) & freqDimsmin];
    const splError150 = iemsFR[i + 150] - curFreq[(i + 150) & freqDimsmin];
    const splError151 = iemsFR[i + 151] - curFreq[(i + 151) & freqDimsmin];
    const splError152 = iemsFR[i + 152] - curFreq[(i + 152) & freqDimsmin];
    const splError153 = iemsFR[i + 153] - curFreq[(i + 153) & freqDimsmin];
    const splError154 = iemsFR[i + 154] - curFreq[(i + 154) & freqDimsmin];
    const splError155 = iemsFR[i + 155] - curFreq[(i + 155) & freqDimsmin];
    const splError156 = iemsFR[i + 156] - curFreq[(i + 156) & freqDimsmin];
    const splError157 = iemsFR[i + 157] - curFreq[(i + 157) & freqDimsmin];
    const splError158 = iemsFR[i + 158] - curFreq[(i + 158) & freqDimsmin];
    const splError159 = iemsFR[i + 159] - curFreq[(i + 159) & freqDimsmin];
    const splError160 = iemsFR[i + 160] - curFreq[(i + 160) & freqDimsmin];
    const splError161 = iemsFR[i + 161] - curFreq[(i + 161) & freqDimsmin];
    const splError162 = iemsFR[i + 162] - curFreq[(i + 162) & freqDimsmin];
    const splError163 = iemsFR[i + 163] - curFreq[(i + 163) & freqDimsmin];
    const splError164 = iemsFR[i + 164] - curFreq[(i + 164) & freqDimsmin];
    const splError165 = iemsFR[i + 165] - curFreq[(i + 165) & freqDimsmin];
    const splError166 = iemsFR[i + 166] - curFreq[(i + 166) & freqDimsmin];
    const splError167 = iemsFR[i + 167] - curFreq[(i + 167) & freqDimsmin];
    const splError168 = iemsFR[i + 168] - curFreq[(i + 168) & freqDimsmin];
    const splError169 = iemsFR[i + 169] - curFreq[(i + 169) & freqDimsmin];
    const splError170 = iemsFR[i + 170] - curFreq[(i + 170) & freqDimsmin];
    const splError171 = iemsFR[i + 171] - curFreq[(i + 171) & freqDimsmin];
    const splError172 = iemsFR[i + 172] - curFreq[(i + 172) & freqDimsmin];
    const splError173 = iemsFR[i + 173] - curFreq[(i + 173) & freqDimsmin];
    const splError174 = iemsFR[i + 174] - curFreq[(i + 174) & freqDimsmin];
    const splError175 = iemsFR[i + 175] - curFreq[(i + 175) & freqDimsmin];
    const splError176 = iemsFR[i + 176] - curFreq[(i + 176) & freqDimsmin];
    const splError177 = iemsFR[i + 177] - curFreq[(i + 177) & freqDimsmin];
    const splError178 = iemsFR[i + 178] - curFreq[(i + 178) & freqDimsmin];
    const splError179 = iemsFR[i + 179] - curFreq[(i + 179) & freqDimsmin];
    const splError180 = iemsFR[i + 180] - curFreq[(i + 180) & freqDimsmin];
    const splError181 = iemsFR[i + 181] - curFreq[(i + 181) & freqDimsmin];
    const splError182 = iemsFR[i + 182] - curFreq[(i + 182) & freqDimsmin];
    const splError183 = iemsFR[i + 183] - curFreq[(i + 183) & freqDimsmin];
    const splError184 = iemsFR[i + 184] - curFreq[(i + 184) & freqDimsmin];
    const splError185 = iemsFR[i + 185] - curFreq[(i + 185) & freqDimsmin];
    const splError186 = iemsFR[i + 186] - curFreq[(i + 186) & freqDimsmin];
    const splError187 = iemsFR[i + 187] - curFreq[(i + 187) & freqDimsmin];
    const splError188 = iemsFR[i + 188] - curFreq[(i + 188) & freqDimsmin];
    const splError189 = iemsFR[i + 189] - curFreq[(i + 189) & freqDimsmin];
    const splError190 = iemsFR[i + 190] - curFreq[(i + 190) & freqDimsmin];
    const splError191 = iemsFR[i + 191] - curFreq[(i + 191) & freqDimsmin];
    const splError192 = iemsFR[i + 192] - curFreq[(i + 192) & freqDimsmin];
    const splError193 = iemsFR[i + 193] - curFreq[(i + 193) & freqDimsmin];
    const splError194 = iemsFR[i + 194] - curFreq[(i + 194) & freqDimsmin];
    const splError195 = iemsFR[i + 195] - curFreq[(i + 195) & freqDimsmin];
    const splError196 = iemsFR[i + 196] - curFreq[(i + 196) & freqDimsmin];
    const splError197 = iemsFR[i + 197] - curFreq[(i + 197) & freqDimsmin];
    const splError198 = iemsFR[i + 198] - curFreq[(i + 198) & freqDimsmin];
    const splError199 = iemsFR[i + 199] - curFreq[(i + 199) & freqDimsmin];
    const splError200 = iemsFR[i + 200] - curFreq[(i + 200) & freqDimsmin];
    const splError201 = iemsFR[i + 201] - curFreq[(i + 201) & freqDimsmin];
    const splError202 = iemsFR[i + 202] - curFreq[(i + 202) & freqDimsmin];
    const splError203 = iemsFR[i + 203] - curFreq[(i + 203) & freqDimsmin];
    const splError204 = iemsFR[i + 204] - curFreq[(i + 204) & freqDimsmin];
    const splError205 = iemsFR[i + 205] - curFreq[(i + 205) & freqDimsmin];
    const splError206 = iemsFR[i + 206] - curFreq[(i + 206) & freqDimsmin];
    const splError207 = iemsFR[i + 207] - curFreq[(i + 207) & freqDimsmin];
    const splError208 = iemsFR[i + 208] - curFreq[(i + 208) & freqDimsmin];
    const splError209 = iemsFR[i + 209] - curFreq[(i + 209) & freqDimsmin];
    const splError210 = iemsFR[i + 210] - curFreq[(i + 210) & freqDimsmin];
    const splError211 = iemsFR[i + 211] - curFreq[(i + 211) & freqDimsmin];
    const splError212 = iemsFR[i + 212] - curFreq[(i + 212) & freqDimsmin];
    const splError213 = iemsFR[i + 213] - curFreq[(i + 213) & freqDimsmin];
    const splError214 = iemsFR[i + 214] - curFreq[(i + 214) & freqDimsmin];
    const splError215 = iemsFR[i + 215] - curFreq[(i + 215) & freqDimsmin];
    const splError216 = iemsFR[i + 216] - curFreq[(i + 216) & freqDimsmin];
    const splError217 = iemsFR[i + 217] - curFreq[(i + 217) & freqDimsmin];
    const splError218 = iemsFR[i + 218] - curFreq[(i + 218) & freqDimsmin];
    const splError219 = iemsFR[i + 219] - curFreq[(i + 219) & freqDimsmin];
    const splError220 = iemsFR[i + 220] - curFreq[(i + 220) & freqDimsmin];
    const splError221 = iemsFR[i + 221] - curFreq[(i + 221) & freqDimsmin];
    const splError222 = iemsFR[i + 222] - curFreq[(i + 222) & freqDimsmin];
    const splError223 = iemsFR[i + 223] - curFreq[(i + 223) & freqDimsmin];
    const splError224 = iemsFR[i + 224] - curFreq[(i + 224) & freqDimsmin];
    const splError225 = iemsFR[i + 225] - curFreq[(i + 225) & freqDimsmin];
    const splError226 = iemsFR[i + 226] - curFreq[(i + 226) & freqDimsmin];
    const splError227 = iemsFR[i + 227] - curFreq[(i + 227) & freqDimsmin];
    const splError228 = iemsFR[i + 228] - curFreq[(i + 228) & freqDimsmin];
    const splError229 = iemsFR[i + 229] - curFreq[(i + 229) & freqDimsmin];
    const splError230 = iemsFR[i + 230] - curFreq[(i + 230) & freqDimsmin];
    const splError231 = iemsFR[i + 231] - curFreq[(i + 231) & freqDimsmin];
    const splError232 = iemsFR[i + 232] - curFreq[(i + 232) & freqDimsmin];
    const splError233 = iemsFR[i + 233] - curFreq[(i + 233) & freqDimsmin];
    const splError234 = iemsFR[i + 234] - curFreq[(i + 234) & freqDimsmin];
    const splError235 = iemsFR[i + 235] - curFreq[(i + 235) & freqDimsmin];
    const splError236 = iemsFR[i + 236] - curFreq[(i + 236) & freqDimsmin];
    const splError237 = iemsFR[i + 237] - curFreq[(i + 237) & freqDimsmin];
    const splError238 = iemsFR[i + 238] - curFreq[(i + 238) & freqDimsmin];
    const splError239 = iemsFR[i + 239] - curFreq[(i + 239) & freqDimsmin];
    const splError240 = iemsFR[i + 240] - curFreq[(i + 240) & freqDimsmin];
    const splError241 = iemsFR[i + 241] - curFreq[(i + 241) & freqDimsmin];
    const splError242 = iemsFR[i + 242] - curFreq[(i + 242) & freqDimsmin];
    const splError243 = iemsFR[i + 243] - curFreq[(i + 243) & freqDimsmin];
    const splError244 = iemsFR[i + 244] - curFreq[(i + 244) & freqDimsmin];
    const splError245 = iemsFR[i + 245] - curFreq[(i + 245) & freqDimsmin];
    const splError246 = iemsFR[i + 246] - curFreq[(i + 246) & freqDimsmin];
    const splError247 = iemsFR[i + 247] - curFreq[(i + 247) & freqDimsmin];
    const splError248 = iemsFR[i + 248] - curFreq[(i + 248) & freqDimsmin];
    const splError249 = iemsFR[i + 249] - curFreq[(i + 249) & freqDimsmin];
    const splError250 = iemsFR[i + 250] - curFreq[(i + 250) & freqDimsmin];
    const splError251 = iemsFR[i + 251] - curFreq[(i + 251) & freqDimsmin];
    const splError252 = iemsFR[i + 252] - curFreq[(i + 252) & freqDimsmin];
    const splError253 = iemsFR[i + 253] - curFreq[(i + 253) & freqDimsmin];
    const splError254 = iemsFR[i + 254] - curFreq[(i + 254) & freqDimsmin];
    const splError255 = iemsFR[i + 255] - curFreq[(i + 255) & freqDimsmin];
    sumnoAbs[i & freqDimsmin] =
      (splError0 +
        splError1 +
        splError2 +
        splError3 +
        splError4 +
        splError5 +
        splError6 +
        splError7 +
        splError8 +
        splError9 +
        splError10 +
        splError11 +
        splError12 +
        splError13 +
        splError14 +
        splError15 +
        splError16 +
        splError17 +
        splError18 +
        splError19 +
        splError20 +
        splError21 +
        splError22 +
        splError23 +
        splError24 +
        splError25 +
        splError26 +
        splError27 +
        splError28 +
        splError29 +
        splError30 +
        splError31 +
        splError32 +
        splError33 +
        splError34 +
        splError35 +
        splError36 +
        splError37 +
        splError38 +
        splError39 +
        splError40 +
        splError41 +
        splError42 +
        splError43 +
        splError44 +
        splError45 +
        splError46 +
        splError47 +
        splError48 +
        splError49 +
        splError50 +
        splError51 +
        splError52 +
        splError53 +
        splError54 +
        splError55 +
        splError56 +
        splError57 +
        splError58 +
        splError59 +
        splError60 +
        splError61 +
        splError62 +
        splError63 +
        splError64 +
        splError65 +
        splError66 +
        splError67 +
        splError68 +
        splError69 +
        splError70 +
        splError71 +
        splError72 +
        splError73 +
        splError74 +
        splError75 +
        splError76 +
        splError77 +
        splError78 +
        splError79 +
        splError80 +
        splError81 +
        splError82 +
        splError83 +
        splError84 +
        splError85 +
        splError86 +
        splError87 +
        splError88 +
        splError89 +
        splError90 +
        splError91 +
        splError92 +
        splError93 +
        splError94 +
        splError95 +
        splError96 +
        splError97 +
        splError98 +
        splError99 +
        splError100 +
        splError101 +
        splError102 +
        splError103 +
        splError104 +
        splError105 +
        splError106 +
        splError107 +
        splError108 +
        splError109 +
        splError110 +
        splError111 +
        splError112 +
        splError113 +
        splError114 +
        splError115 +
        splError116 +
        splError117 +
        splError118 +
        splError119 +
        splError120 +
        splError121 +
        splError122 +
        splError123 +
        splError124 +
        splError125 +
        splError126 +
        splError127 +
        splError128 +
        splError129 +
        splError130 +
        splError131 +
        splError132 +
        splError133 +
        splError134 +
        splError135 +
        splError136 +
        splError137 +
        splError138 +
        splError139 +
        splError140 +
        splError141 +
        splError142 +
        splError143 +
        splError144 +
        splError145 +
        splError146 +
        splError147 +
        splError148 +
        splError149 +
        splError150 +
        splError151 +
        splError152 +
        splError153 +
        splError154 +
        splError155 +
        splError156 +
        splError157 +
        splError158 +
        splError159 +
        splError160 +
        splError161 +
        splError162 +
        splError163 +
        splError164 +
        splError165 +
        splError166 +
        splError167 +
        splError168 +
        splError169 +
        splError170 +
        splError171 +
        splError172 +
        splError173 +
        splError174 +
        splError175 +
        splError176 +
        splError177 +
        splError178 +
        splError179 +
        splError180 +
        splError181 +
        splError182 +
        splError183 +
        splError184 +
        splError185 +
        splError186 +
        splError187 +
        splError188 +
        splError189 +
        splError190 +
        splError191 +
        splError192 +
        splError193 +
        splError194 +
        splError195 +
        splError196 +
        splError197 +
        splError198 +
        splError199 +
        splError200 +
        splError201 +
        splError202 +
        splError203 +
        splError204 +
        splError205 +
        splError206 +
        splError207 +
        splError208 +
        splError209 +
        splError210 +
        splError211 +
        splError212 +
        splError213 +
        splError214 +
        splError215 +
        splError216 +
        splError217 +
        splError218 +
        splError219 +
        splError220 +
        splError221 +
        splError222 +
        splError223 +
        splError224 +
        splError225 +
        splError226 +
        splError227 +
        splError228 +
        splError229 +
        splError230 +
        splError231 +
        splError232 +
        splError233 +
        splError234 +
        splError235 +
        splError236 +
        splError237 +
        splError238 +
        splError239 +
        splError240 +
        splError241 +
        splError242 +
        splError243 +
        splError244 +
        splError245 +
        splError246 +
        splError247 +
        splError248 +
        splError249 +
        splError250 +
        splError251 +
        splError252 +
        splError253 +
        splError254 +
        splError255) /
      freqDims;
    sumAll[i & freqDimsmin] =
      (mathAbs(splError0) +
        mathAbs(splError1) +
        mathAbs(splError2) +
        mathAbs(splError3) +
        mathAbs(splError4) +
        mathAbs(splError5) +
        mathAbs(splError6) +
        mathAbs(splError7) +
        mathAbs(splError8) +
        mathAbs(splError9) +
        mathAbs(splError10) +
        mathAbs(splError11) +
        mathAbs(splError12) +
        mathAbs(splError13) +
        mathAbs(splError14) +
        mathAbs(splError15) +
        mathAbs(splError16) +
        mathAbs(splError17) +
        mathAbs(splError18) +
        mathAbs(splError19) +
        mathAbs(splError20) +
        mathAbs(splError21) +
        mathAbs(splError22) +
        mathAbs(splError23) +
        mathAbs(splError24) +
        mathAbs(splError25) +
        mathAbs(splError26) +
        mathAbs(splError27) +
        mathAbs(splError28) +
        mathAbs(splError29) +
        mathAbs(splError30) +
        mathAbs(splError31) +
        mathAbs(splError32) +
        mathAbs(splError33) +
        mathAbs(splError34) +
        mathAbs(splError35) +
        mathAbs(splError36) +
        mathAbs(splError37) +
        mathAbs(splError38) +
        mathAbs(splError39) +
        mathAbs(splError40) +
        mathAbs(splError41) +
        mathAbs(splError42) +
        mathAbs(splError43) +
        mathAbs(splError44) +
        mathAbs(splError45) +
        mathAbs(splError46) +
        mathAbs(splError47) +
        mathAbs(splError48) +
        mathAbs(splError49) +
        mathAbs(splError50) +
        mathAbs(splError51) +
        mathAbs(splError52) +
        mathAbs(splError53) +
        mathAbs(splError54) +
        mathAbs(splError55) +
        mathAbs(splError56) +
        mathAbs(splError57) +
        mathAbs(splError58) +
        mathAbs(splError59) +
        mathAbs(splError60) +
        mathAbs(splError61) +
        mathAbs(splError62) +
        mathAbs(splError63) +
        mathAbs(splError64) +
        mathAbs(splError65) +
        mathAbs(splError66) +
        mathAbs(splError67) +
        mathAbs(splError68) +
        mathAbs(splError69) +
        mathAbs(splError70) +
        mathAbs(splError71) +
        mathAbs(splError72) +
        mathAbs(splError73) +
        mathAbs(splError74) +
        mathAbs(splError75) +
        mathAbs(splError76) +
        mathAbs(splError77) +
        mathAbs(splError78) +
        mathAbs(splError79) +
        mathAbs(splError80) +
        mathAbs(splError81) +
        mathAbs(splError82) +
        mathAbs(splError83) +
        mathAbs(splError84) +
        mathAbs(splError85) +
        mathAbs(splError86) +
        mathAbs(splError87) +
        mathAbs(splError88) +
        mathAbs(splError89) +
        mathAbs(splError90) +
        mathAbs(splError91) +
        mathAbs(splError92) +
        mathAbs(splError93) +
        mathAbs(splError94) +
        mathAbs(splError95) +
        mathAbs(splError96) +
        mathAbs(splError97) +
        mathAbs(splError98) +
        mathAbs(splError99) +
        mathAbs(splError100) +
        mathAbs(splError101) +
        mathAbs(splError102) +
        mathAbs(splError103) +
        mathAbs(splError104) +
        mathAbs(splError105) +
        mathAbs(splError106) +
        mathAbs(splError107) +
        mathAbs(splError108) +
        mathAbs(splError109) +
        mathAbs(splError110) +
        mathAbs(splError111) +
        mathAbs(splError112) +
        mathAbs(splError113) +
        mathAbs(splError114) +
        mathAbs(splError115) +
        mathAbs(splError116) +
        mathAbs(splError117) +
        mathAbs(splError118) +
        mathAbs(splError119) +
        mathAbs(splError120) +
        mathAbs(splError121) +
        mathAbs(splError122) +
        mathAbs(splError123) +
        mathAbs(splError124) +
        mathAbs(splError125) +
        mathAbs(splError126) +
        mathAbs(splError127) +
        mathAbs(splError128) +
        mathAbs(splError129) +
        mathAbs(splError130) +
        mathAbs(splError131) +
        mathAbs(splError132) +
        mathAbs(splError133) +
        mathAbs(splError134) +
        mathAbs(splError135) +
        mathAbs(splError136) +
        mathAbs(splError137) +
        mathAbs(splError138) +
        mathAbs(splError139) +
        mathAbs(splError140) +
        mathAbs(splError141) +
        mathAbs(splError142) +
        mathAbs(splError143) +
        mathAbs(splError144) +
        mathAbs(splError145) +
        mathAbs(splError146) +
        mathAbs(splError147) +
        mathAbs(splError148) +
        mathAbs(splError149) +
        mathAbs(splError150) +
        mathAbs(splError151) +
        mathAbs(splError152) +
        mathAbs(splError153) +
        mathAbs(splError154) +
        mathAbs(splError155) +
        mathAbs(splError156) +
        mathAbs(splError157) +
        mathAbs(splError158) +
        mathAbs(splError159) +
        mathAbs(splError160) +
        mathAbs(splError161) +
        mathAbs(splError162) +
        mathAbs(splError163) +
        mathAbs(splError164) +
        mathAbs(splError165) +
        mathAbs(splError166) +
        mathAbs(splError167) +
        mathAbs(splError168) +
        mathAbs(splError169) +
        mathAbs(splError170) +
        mathAbs(splError171) +
        mathAbs(splError172) +
        mathAbs(splError173) +
        mathAbs(splError174) +
        mathAbs(splError175) +
        mathAbs(splError176) +
        mathAbs(splError177) +
        mathAbs(splError178) +
        mathAbs(splError179) +
        mathAbs(splError180) +
        mathAbs(splError181) +
        mathAbs(splError182) +
        mathAbs(splError183) +
        mathAbs(splError184) +
        mathAbs(splError185) +
        mathAbs(splError186) +
        mathAbs(splError187) +
        mathAbs(splError188) +
        mathAbs(splError189) +
        mathAbs(splError190) +
        mathAbs(splError191) +
        mathAbs(splError192) +
        mathAbs(splError193) +
        mathAbs(splError194) +
        mathAbs(splError195) +
        mathAbs(splError196) +
        mathAbs(splError197) +
        mathAbs(splError198) +
        mathAbs(splError199) +
        mathAbs(splError200) +
        mathAbs(splError201) +
        mathAbs(splError202) +
        mathAbs(splError203) +
        mathAbs(splError204) +
        mathAbs(splError205) +
        mathAbs(splError206) +
        mathAbs(splError207) +
        mathAbs(splError208) +
        mathAbs(splError209) +
        mathAbs(splError210) +
        mathAbs(splError211) +
        mathAbs(splError212) +
        mathAbs(splError213) +
        mathAbs(splError214) +
        mathAbs(splError215) +
        mathAbs(splError216) +
        mathAbs(splError217) +
        mathAbs(splError218) +
        mathAbs(splError219) +
        mathAbs(splError220) +
        mathAbs(splError221) +
        mathAbs(splError222) +
        mathAbs(splError223) +
        mathAbs(splError224) +
        mathAbs(splError225) +
        mathAbs(splError226) +
        mathAbs(splError227) +
        mathAbs(splError228) +
        mathAbs(splError229) +
        mathAbs(splError230) +
        mathAbs(splError231) +
        mathAbs(splError232) +
        mathAbs(splError233) +
        mathAbs(splError234) +
        mathAbs(splError235) +
        mathAbs(splError236) +
        mathAbs(splError237) +
        mathAbs(splError238) +
        mathAbs(splError239) +
        mathAbs(splError240) +
        mathAbs(splError241) +
        mathAbs(splError242) +
        mathAbs(splError243) +
        mathAbs(splError244) +
        mathAbs(splError245) +
        mathAbs(splError246) +
        mathAbs(splError247) +
        mathAbs(splError248) +
        mathAbs(splError249) +
        mathAbs(splError250) +
        mathAbs(splError251) +
        mathAbs(splError252) +
        mathAbs(splError253) +
        mathAbs(splError254) +
        mathAbs(splError255)) /
      freqDims;
    sqrSum[i & freqDimsmin] =
      splError0 * splError0 +
      splError1 * splError1 +
      splError2 * splError2 +
      splError3 * splError3 +
      splError4 * splError4 +
      splError5 * splError5 +
      splError6 * splError6 +
      splError7 * splError7 +
      splError8 * splError8 +
      splError9 * splError9 +
      splError10 * splError10 +
      splError11 * splError11 +
      splError12 * splError12 +
      splError13 * splError13 +
      splError14 * splError14 +
      splError15 * splError15 +
      splError16 * splError16 +
      splError17 * splError17 +
      splError18 * splError18 +
      splError19 * splError19 +
      splError20 * splError20 +
      splError21 * splError21 +
      splError22 * splError22 +
      splError23 * splError23 +
      splError24 * splError24 +
      splError25 * splError25 +
      splError26 * splError26 +
      splError27 * splError27 +
      splError28 * splError28 +
      splError29 * splError29 +
      splError30 * splError30 +
      splError31 * splError31 +
      splError32 * splError32 +
      splError33 * splError33 +
      splError34 * splError34 +
      splError35 * splError35 +
      splError36 * splError36 +
      splError37 * splError37 +
      splError38 * splError38 +
      splError39 * splError39 +
      splError40 * splError40 +
      splError41 * splError41 +
      splError42 * splError42 +
      splError43 * splError43 +
      splError44 * splError44 +
      splError45 * splError45 +
      splError46 * splError46 +
      splError47 * splError47 +
      splError48 * splError48 +
      splError49 * splError49 +
      splError50 * splError50 +
      splError51 * splError51 +
      splError52 * splError52 +
      splError53 * splError53 +
      splError54 * splError54 +
      splError55 * splError55 +
      splError56 * splError56 +
      splError57 * splError57 +
      splError58 * splError58 +
      splError59 * splError59 +
      splError60 * splError60 +
      splError61 * splError61 +
      splError62 * splError62 +
      splError63 * splError63 +
      splError64 * splError64 +
      splError65 * splError65 +
      splError66 * splError66 +
      splError67 * splError67 +
      splError68 * splError68 +
      splError69 * splError69 +
      splError70 * splError70 +
      splError71 * splError71 +
      splError72 * splError72 +
      splError73 * splError73 +
      splError74 * splError74 +
      splError75 * splError75 +
      splError76 * splError76 +
      splError77 * splError77 +
      splError78 * splError78 +
      splError79 * splError79 +
      splError80 * splError80 +
      splError81 * splError81 +
      splError82 * splError82 +
      splError83 * splError83 +
      splError84 * splError84 +
      splError85 * splError85 +
      splError86 * splError86 +
      splError87 * splError87 +
      splError88 * splError88 +
      splError89 * splError89 +
      splError90 * splError90 +
      splError91 * splError91 +
      splError92 * splError92 +
      splError93 * splError93 +
      splError94 * splError94 +
      splError95 * splError95 +
      splError96 * splError96 +
      splError97 * splError97 +
      splError98 * splError98 +
      splError99 * splError99 +
      splError100 * splError100 +
      splError101 * splError101 +
      splError102 * splError102 +
      splError103 * splError103 +
      splError104 * splError104 +
      splError105 * splError105 +
      splError106 * splError106 +
      splError107 * splError107 +
      splError108 * splError108 +
      splError109 * splError109 +
      splError110 * splError110 +
      splError111 * splError111 +
      splError112 * splError112 +
      splError113 * splError113 +
      splError114 * splError114 +
      splError115 * splError115 +
      splError116 * splError116 +
      splError117 * splError117 +
      splError118 * splError118 +
      splError119 * splError119 +
      splError120 * splError120 +
      splError121 * splError121 +
      splError122 * splError122 +
      splError123 * splError123 +
      splError124 * splError124 +
      splError125 * splError125 +
      splError126 * splError126 +
      splError127 * splError127 +
      splError128 * splError128 +
      splError129 * splError129 +
      splError130 * splError130 +
      splError131 * splError131 +
      splError132 * splError132 +
      splError133 * splError133 +
      splError134 * splError134 +
      splError135 * splError135 +
      splError136 * splError136 +
      splError137 * splError137 +
      splError138 * splError138 +
      splError139 * splError139 +
      splError140 * splError140 +
      splError141 * splError141 +
      splError142 * splError142 +
      splError143 * splError143 +
      splError144 * splError144 +
      splError145 * splError145 +
      splError146 * splError146 +
      splError147 * splError147 +
      splError148 * splError148 +
      splError149 * splError149 +
      splError150 * splError150 +
      splError151 * splError151 +
      splError152 * splError152 +
      splError153 * splError153 +
      splError154 * splError154 +
      splError155 * splError155 +
      splError156 * splError156 +
      splError157 * splError157 +
      splError158 * splError158 +
      splError159 * splError159 +
      splError160 * splError160 +
      splError161 * splError161 +
      splError162 * splError162 +
      splError163 * splError163 +
      splError164 * splError164 +
      splError165 * splError165 +
      splError166 * splError166 +
      splError167 * splError167 +
      splError168 * splError168 +
      splError169 * splError169 +
      splError170 * splError170 +
      splError171 * splError171 +
      splError172 * splError172 +
      splError173 * splError173 +
      splError174 * splError174 +
      splError175 * splError175 +
      splError176 * splError176 +
      splError177 * splError177 +
      splError178 * splError178 +
      splError179 * splError179 +
      splError180 * splError180 +
      splError181 * splError181 +
      splError182 * splError182 +
      splError183 * splError183 +
      splError184 * splError184 +
      splError185 * splError185 +
      splError186 * splError186 +
      splError187 * splError187 +
      splError188 * splError188 +
      splError189 * splError189 +
      splError190 * splError190 +
      splError191 * splError191 +
      splError192 * splError192 +
      splError193 * splError193 +
      splError194 * splError194 +
      splError195 * splError195 +
      splError196 * splError196 +
      splError197 * splError197 +
      splError198 * splError198 +
      splError199 * splError199 +
      splError200 * splError200 +
      splError201 * splError201 +
      splError202 * splError202 +
      splError203 * splError203 +
      splError204 * splError204 +
      splError205 * splError205 +
      splError206 * splError206 +
      splError207 * splError207 +
      splError208 * splError208 +
      splError209 * splError209 +
      splError210 * splError210 +
      splError211 * splError211 +
      splError212 * splError212 +
      splError213 * splError213 +
      splError214 * splError214 +
      splError215 * splError215 +
      splError216 * splError216 +
      splError217 * splError217 +
      splError218 * splError218 +
      splError219 * splError219 +
      splError220 * splError220 +
      splError221 * splError221 +
      splError222 * splError222 +
      splError223 * splError223 +
      splError224 * splError224 +
      splError225 * splError225 +
      splError226 * splError226 +
      splError227 * splError227 +
      splError228 * splError228 +
      splError229 * splError229 +
      splError230 * splError230 +
      splError231 * splError231 +
      splError232 * splError232 +
      splError233 * splError233 +
      splError234 * splError234 +
      splError235 * splError235 +
      splError236 * splError236 +
      splError237 * splError237 +
      splError238 * splError238 +
      splError239 * splError239 +
      splError240 * splError240 +
      splError241 * splError241 +
      splError242 * splError242 +
      splError243 * splError243 +
      splError244 * splError244 +
      splError245 * splError245 +
      splError246 * splError246 +
      splError247 * splError247 +
      splError248 * splError248 +
      splError249 * splError249 +
      splError250 * splError250 +
      splError251 * splError251 +
      splError252 * splError252 +
      splError253 * splError253 +
      splError254 * splError254 +
      splError255 * splError255;
  }

  // Reset allData
  allData.length = 0;
  for (var i in iemsData.response) {
    let name = iemsData.name[i];
    let path = iemsData.paths[i];
    let meanErr = sumAll[i];
    if (meanErr < 0.01) {
      continue;
    }

    let stdErr = Math.sqrt(sqrSum[i] / freqDims - sumnoAbs[i] * sumnoAbs[i]);

    // preference score lacks slope (for now)
    let prefScore = 100.0795 - 8.5 * stdErr - 3.475 * meanErr;
    if (prefScore < 0) {
      continue;
    }
    allData.push({
      name: name,
      path: path,
      stdErr: ~~(stdErr * 100) / 100,
      meanErr: ~~(meanErr * 100) / 100,
      prefScore: ~~(prefScore * 100) / 100,
    });
  }
  console.log("Time taken: " + (performance.now() - start) + "ms");

  // Sort allData based on prefScore, high to low
  allData.sort((a, b) => b.prefScore - a.prefScore);

  sortData();
  renderTable(allData);
  renderPagination(allData);
}

function sortData() {
  const { column, direction } = currentSort;
  allData.sort((a, b) => {
    if (a[column] < b[column]) return direction === "asc" ? -1 : 1;
    if (a[column] > b[column]) return direction === "asc" ? 1 : -1;
    return 0;
  });
}

function updateSortIcons() {
  const headers = document.querySelectorAll("th[data-sort]");
  headers.forEach((header) => {
    header.classList.remove("sort-icon", "desc");
    if (header.dataset.sort === currentSort.column) {
      header.classList.add("sort-icon");
      if (currentSort.direction === "desc") {
        header.classList.add("desc");
      }
    }
  });
}

document.querySelectorAll("th[data-sort]").forEach((header) => {
  header.addEventListener("click", () => {
    const column = header.dataset.sort;
    if (currentSort.column === column) {
      currentSort.direction = currentSort.direction === "asc" ? "desc" : "asc";
    } else {
      currentSort.column = column;
      currentSort.direction = "asc";
    }
    sortData();
    renderTable(allData);
  });
});

window.requestIdleCallback =
  window.requestIdleCallback ||
  function (cb) {
    var start = Date.now();
    return setTimeout(function () {
      cb({
        didTimeout: false,
        timeRemaining: function () {
          return Math.max(0, 50 - (Date.now() - start));
        },
      });
    }, 1);
  };

document.addEventListener("DOMContentLoaded", async function () {
  document.getElementById("searchBox").addEventListener("input", searchTable);
  await changeSourceData("data/super.cbor.gz");

  // https://nolanlawson.com/2021/08/08/improving-responsiveness-in-text-inputs/
  let queued = false;
  let textarea = document.getElementById("search-iem");
  textarea.addEventListener("input", (e) => {
    if (!queued) {
      queued = true;
      requestIdleCallback(() => {
        showSuggestions(textarea.value);
        queued = false;
      });
    }
  });
});
