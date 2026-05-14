async function main() {
  const url = "https://script.google.com/macros/s/AKfycbyoKmgydF-B4Um-F07SmCvHOiHuufvRcLsnOGTS8QWKtP3869vYOkRYz-EOkcuPW1r1/exec?sheetName=" + encodeURIComponent("上市櫃三大法人買賣超");
  const res = await fetch(url);
  const data = await res.json();
  if (Array.isArray(data) && data.length > 0) {
     console.log(Object.keys(data[0]));
     console.log(JSON.stringify(data[0]));
  }
}
main();
