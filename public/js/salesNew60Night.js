console.log("60 NT wired correctly")
function toggle60NightTrial(isMattress) {
  const header = document.getElementById("60ntheader");
  const cell = document.getElementById("60ntSelect");

  if (!header || !cell) return;

  if (isMattress) {
    header.style.display = "table-cell";
    cell.style.display = "table-cell";
  } else {
    header.style.display = "none";
    cell.style.display = "none";
  }
}
