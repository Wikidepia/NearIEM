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

function findSimilarIEM(iemName) {
  const start = performance.now();
  const selectedIdx = iemsData.name.indexOf(iemName);
  const curFreq = iemsData.response[selectedIdx];

  const iemsCnt = iemsData.name.length;
  const freqDims = curFreq.length;

  const sqrSum = new Float32Array(iemsCnt);
  const sumnoAbs = new Float32Array(iemsCnt);
  const sumAll = new Float32Array(iemsCnt);

  let j = -1;
  const mathAbs = Math.abs;
  const iemsFRLen = iemsFR.length;
  for (let i = 0; i < iemsFRLen; i++) {
    if ((i & 255) === 0) {
      // Find mean for std and MAE
      sumAll[j] /= freqDims;
      sumnoAbs[j] /= freqDims;
      j++;
    }

    const splError = iemsFR[i] - curFreq[i & (freqDims - 1)];
    sumnoAbs[j] += splError;
    sumAll[j] += mathAbs(splError);
    sqrSum[j] += splError * splError;
  }

  // Handle the remaining elements after loop exit
  sumAll[j] /= freqDims;
  sumnoAbs[j] /= freqDims;

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
