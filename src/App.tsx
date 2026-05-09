import { useState, useEffect, useMemo, useRef } from 'react';
import Papa from 'papaparse';
import { AlertCircle, RefreshCcw, Table2, Search, Code, Copy, CheckCircle2, ChevronRight, Menu, LayoutTemplate } from 'lucide-react';

const DEFAULT_API_URL = "https://script.google.com/macros/s/AKfycbyoKmgydF-B4Um-F07SmCvHOiHuufvRcLsnOGTS8QWKtP3869vYOkRYz-EOkcuPW1r1/exec";

export default function App() {
  const [data, setData] = useState<any[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Sidebar & Sheets State
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => typeof window !== 'undefined' ? window.innerWidth >= 768 : true);
  const [sheets, setSheets] = useState<string[]>([]);
  const [allSheetsData, setAllSheetsData] = useState<Record<string, any[]>>({});
  const [selectedSheet, setSelectedSheet] = useState<string | null>(null);
  const [loadingSheets, setLoadingSheets] = useState(false);
  
  // GAS Code modal state
  const [showGasCode, setShowGasCode] = useState(false);
  const [copied, setCopied] = useState(false);
  const [needsGasUpdate, setNeedsGasUpdate] = useState(false);

  // You can still manually test another URL in code, but UI hides it.
  const apiUrl = DEFAULT_API_URL;

  const sheetId = '1g9a8dYJyQasjI2LpEw2RsHkT3aBZX-nO93KllENIN-c';
  const viewerUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;

  const fetchSheets = async () => {
    setLoadingSheets(true);
    setLoading(true);
    setNeedsGasUpdate(false);
    try {
      const response = await fetch(`${apiUrl}?action=getAllData`);
      
      if (!response.ok) throw new Error(`API 請求失敗: ${response.statusText}`);
      const jsonData = await response.json();
      
      if (jsonData && jsonData.allData) {
        setAllSheetsData(jsonData.allData);
        setSheets(jsonData.sheets || []);
        if (jsonData.sheets?.length > 0 && !selectedSheet) {
          setSelectedSheet(jsonData.sheets[0]);
        }
      } else if (jsonData && jsonData.sheets) {
        setNeedsGasUpdate(true);
        setSheets(jsonData.sheets);
        if (jsonData.sheets.length > 0 && !selectedSheet) {
          setSelectedSheet(jsonData.sheets[0]);
        }
      } else if (Array.isArray(jsonData)) {
        // If it returned an array directly, the GAS script doesn't support getSheets yet
        setNeedsGasUpdate(true);
        setSheets(["預設工作表"]);
        if (!selectedSheet) setSelectedSheet("預設工作表");
        
        // Load default data right away to be nice
        setAllSheetsData({ "預設工作表": jsonData });
        setData(jsonData);
        if (jsonData.length > 0) {
            setColumns(Object.keys(jsonData[0]));
        }
      } else {
        setError('API 回傳格式不正確');
      }
    } catch (err: any) {
      console.error("Fetch sheets error:", err);
      setError(`無法讀取工作表清單: ${err.message}`);
    } finally {
      setLoadingSheets(false);
      setLoading(false);
    }
  };

  const loadData = async (sheetName: string, forceRefresh = false) => {
    setLoading(true);
    setError(null);
    
    // 如果沒有強制整理，且記憶體有資料，直接顯示
    if (!forceRefresh && allSheetsData[sheetName]) {
      const sheetData = allSheetsData[sheetName];
      setData(sheetData);
      if (sheetData.length > 0) {
         setColumns(Object.keys(sheetData[0] as object));
      } else {
         setColumns([]);
         setError('此工作表為空，沒有資料。');
      }
      setLoading(false);
      return;
    }
    
    try {
      const url = sheetName === "預設工作表" 
         ? apiUrl 
         : `${apiUrl}?sheetName=${encodeURIComponent(sheetName)}`;
         
      const response = await fetch(url);
      if (!response.ok) throw new Error(`API 請求失敗: ${response.statusText}`);
      const jsonData = await response.json();
      
      if (jsonData && jsonData.error) {
         throw new Error(jsonData.error);
      }
      
      let sheetData: any[] = [];
      if (jsonData && jsonData.allData) {
         setAllSheetsData(jsonData.allData);
         if (jsonData.sheets) setSheets(jsonData.sheets);
         sheetData = jsonData.allData[sheetName] || [];
      } else if (Array.isArray(jsonData)) {
         sheetData = jsonData;
      }
      
      if (sheetData.length > 0) {
        setData(sheetData);
        setColumns(Object.keys(sheetData[0] as object));
        setAllSheetsData(prev => ({ ...prev, [sheetName]: sheetData }));
      } else if (sheetData.length === 0 && Array.isArray(jsonData)) {
        setData([]);
        setColumns([]);
        setError('此工作表為空，沒有資料。');
        setAllSheetsData(prev => ({ ...prev, [sheetName]: [] }));
      } else {
        setError('API 回傳格式不正確，找不到股票資料。');
      }
    } catch (err: any) {
      console.error("API error:", err);
      setError(`讀取失敗: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSheets();
  }, []);

  useEffect(() => {
    if (selectedSheet && !needsGasUpdate) {
      loadData(selectedSheet);
    }
  }, [selectedSheet, needsGasUpdate]);

  const gasCode = `function doGet(e) {
  try {
    var sheetId = "1g9a8dYJyQasjI2LpEw2RsHkT3aBZX-nO93KllENIN-c";
    var doc = SpreadsheetApp.openById(sheetId);
    
    var action = e.parameter.action;
    
    // 如果帶有 action=getAllData 參數，回傳所有工作表及資料（加速前端切換）
    if (action === "getAllData") {
      var sheets = doc.getSheets();
      var allData = {};
      var sheetNames = [];
      
      for (var s = 0; s < sheets.length; s++) {
        var sh = sheets[s];
        var sName = sh.getName();
        sheetNames.push(sName);
        var data = sh.getDataRange().getDisplayValues();
        
        var result = [];
        if (data.length > 0) {
          var headers = data[0];
          for (var i = 1; i < data.length; i++) {
            var row = data[i];
            var obj = {};
            for (var j = 0; j < headers.length; j++) {
              if (headers[j]) {
                obj[headers[j]] = row[j];
              }
            }
            result.push(obj);
          }
        }
        allData[sName] = result;
      }
      
      return ContentService.createTextOutput(JSON.stringify({ sheets: sheetNames, allData: allData }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // 如果帶有 action=getSheets 參數，回傳所有工作表名稱
    if (action === "getSheets") {
      var sheets = doc.getSheets();
      var sheetNames = sheets.map(function(s) { return s.getName(); });
      return ContentService.createTextOutput(JSON.stringify({ sheets: sheetNames }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // 如果帶有 sheetName 參數，讀取特定工作表
    var sheetName = e.parameter.sheetName;
    var sheet = sheetName ? doc.getSheetByName(sheetName) : doc.getSheets()[0];
    
    if (!sheet) {
      return ContentService.createTextOutput(JSON.stringify({ error: "找不到指定的工作表" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var data = sheet.getDataRange().getDisplayValues();
    if (data.length === 0) {
      return ContentService.createTextOutput(JSON.stringify({ error: "試算表沒有資料" }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    var headers = data[0];
    var result = [];
    
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var obj = {};
      for (var j = 0; j < headers.length; j++) {
        if (headers[j]) {
          obj[headers[j]] = row[j];
        }
      }
      result.push(obj);
    }
    
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ error: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}`;

  const copyToClipboard = () => {
    navigator.clipboard.writeText(gasCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const filteredData = useMemo(() => {
    if (!searchTerm) return data;
    const lowerSearch = searchTerm.toLowerCase();
    return data.filter(row => 
      columns.some(col => {
         const val = row[col];
         return val !== null && val !== undefined && String(val).toLowerCase().includes(lowerSearch);
      })
    );
  }, [data, columns, searchTerm]);

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden text-gray-900 font-sans">
      
      {/* Sidebar */}
      <aside 
        className={`${isSidebarOpen ? 'w-64' : 'w-0'} shrink-0 bg-white border-r border-gray-200 transition-all duration-300 flex flex-col overflow-hidden z-20 shadow-sm`}
      >
        <div className="h-16 flex items-center px-4 border-b border-gray-200 shrink-0">
          <div className="flex items-center gap-2 text-indigo-600">
             <Table2 className="w-6 h-6" />
             <span className="font-bold text-lg whitespace-nowrap">我的股票資料庫</span>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 px-2">工作表清單</h3>
          
          {loadingSheets ? (
             <div className="flex justify-center py-8">
                <RefreshCcw className="w-5 h-5 text-indigo-400 animate-spin" />
             </div>
          ) : (
            <ul className="space-y-1">
              {sheets.map(sheet => (
                <li key={sheet}>
                  <button
                    onClick={() => {
                        setSelectedSheet(sheet);
                        if (window.innerWidth < 768) setIsSidebarOpen(false);
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-colors ${
                      selectedSheet === sheet 
                        ? 'bg-indigo-50 text-indigo-700 font-medium' 
                        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                    }`}
                  >
                     <span className="truncate">{sheet}</span>
                     {selectedSheet === sheet && <ChevronRight className="w-4 h-4 text-indigo-500" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        
        <div className="p-4 border-t border-gray-200 bg-gray-50 shrink-0">
           <button
             onClick={() => setShowGasCode(true)}
             className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-gray-300 rounded-lg bg-white text-sm font-medium text-gray-700 hover:bg-gray-100 shadow-sm transition-colors"
           >
              <Code className="w-4 h-4" />
              GAS 程式碼設定
           </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full min-w-0 overflow-hidden relative">
        <header className="h-16 shrink-0 bg-white border-b border-gray-200 flex items-center justify-between px-4 sm:px-6 shadow-sm z-10">
          <div className="flex items-center gap-3">
            <button 
               onClick={() => setIsSidebarOpen(!isSidebarOpen)}
               className="p-2 -ml-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-colors"
            >
               <Menu className="w-5 h-5" />
            </button>
            <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
               {selectedSheet || "載入中..."}
            </h2>
          </div>
          
          <div className="flex items-center gap-2 sm:gap-3">
             <button
               onClick={() => selectedSheet ? loadData(selectedSheet, true) : fetchSheets()}
               disabled={loading}
               className="inline-flex items-center gap-1.5 px-3 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors shadow-sm disabled:opacity-50"
             >
                <RefreshCcw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                <span className="hidden sm:inline">重新整理</span>
             </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-gray-50 relative custom-scrollbar">
          <div className="max-w-7xl mx-auto space-y-6">
            
            {needsGasUpdate && (
               <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center gap-4 shadow-sm animate-in fade-in slide-in-from-top-4">
                  <div className="flex-1">
                     <h3 className="font-bold text-amber-900 flex items-center gap-2">
                        <AlertCircle className="w-5 h-5" />
                        需要更新 GAS 程式碼以支援多工作表
                     </h3>
                     <p className="text-amber-800 text-sm mt-1">
                        目前的 API 僅能讀取第一張工作表。若要使用左側選單切換所有工作表，請重新部署更新後的 Google Apps Script 程式碼。
                     </p>
                  </div>
                  <button
                     onClick={() => setShowGasCode(true)}
                     className="shrink-0 px-4 py-2 bg-amber-600 text-white font-medium text-sm rounded-lg shadow-sm hover:bg-amber-700 transition-colors"
                  >
                     查看新版程式碼
                  </button>
               </div>
            )}

            {error ? (
              <div className="bg-red-50 border border-red-200 rounded-xl p-6 shadow-sm">
                <h3 className="text-lg font-semibold text-red-900 flex items-center gap-2">
                   <AlertCircle className="w-5 h-5" /> 取資料時發生錯誤
                </h3>
                <p className="text-red-700 mt-2">{error}</p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm col-span-1">
                        <h3 className="text-sm font-medium text-gray-500">總資料筆數</h3>
                        <p className="text-3xl font-bold mt-1 text-gray-900">{data.length}</p>
                    </div>
                    <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm col-span-1">
                        <h3 className="text-sm font-medium text-gray-500">資料欄位數</h3>
                        <p className="text-3xl font-bold mt-1 text-gray-900">{columns.length}</p>
                    </div>
                    
                    <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm col-span-1 md:col-span-2 flex items-center">
                        <div className="w-full relative">
                            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                                <Search className="h-5 w-5 text-gray-400" />
                            </div>
                            <input
                                type="text"
                                placeholder="搜尋股票代號、名稱或其他關鍵字..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="block w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all shadow-inner"
                            />
                        </div>
                    </div>
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex flex-col" style={{ minHeight: '400px' }}>
                    <div className="overflow-auto custom-scrollbar flex-1 relative">
                    <table className="w-full text-sm text-left">
                      <thead className="text-xs text-gray-600 uppercase bg-gray-50 border-b border-gray-200 sticky top-0 shadow-sm z-10">
                        <tr>
                          {columns.map((col, idx) => (
                            <th key={idx} className="px-5 py-3.5 font-semibold whitespace-nowrap border-r border-gray-100 last:border-0 hover:bg-gray-100/50 cursor-default">
                              {col}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {loading && data.length === 0 ? (
                           <tr>
                              <td colSpan={columns.length || 1} className="px-6 py-20 text-center">
                                 <RefreshCcw className="w-8 h-8 text-indigo-400 animate-spin mx-auto mb-3" />
                                 <p className="text-gray-500 text-sm">正在載入資料...</p>
                              </td>
                           </tr>
                        ) : filteredData.length > 0 ? (
                            filteredData.slice(0, 100).map((row, rowIdx) => (
                            <tr key={rowIdx} className="hover:bg-indigo-50/40 transition-colors">
                                {columns.map((col, colIdx) => {
                                const cellValue = row[col];
                                const isNumericStr = !isNaN(Number(cellValue)) && cellValue !== '' && cellValue !== null;
                                const isNegative = isNumericStr && Number(cellValue) < 0;
                                const isPositive = isNumericStr && Number(cellValue) > 0;
                                
                                return (
                                    <td 
                                        key={colIdx} 
                                        className={`px-5 py-3 max-w-[200px] truncate border-r border-gray-50 last:border-0 ${
                                            isNegative ? 'text-rose-600' : 
                                            isPositive ? 'text-emerald-600' : 
                                            'text-gray-700'
                                        }`}
                                        title={String(cellValue || '')}
                                    >
                                        {cellValue || '-'}
                                    </td>
                                )
                                })}
                            </tr>
                            ))
                        ) : (
                            <tr>
                                <td colSpan={Math.max(columns.length, 1)} className="px-6 py-16 text-center text-gray-500">
                                    <LayoutTemplate className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                                    <p>找不到符合的資料</p>
                                </td>
                            </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  {filteredData.length > 100 && (
                     <div className="p-3 bg-gray-50 text-center text-xs text-gray-500 border-t border-gray-200">
                         僅顯示前 100 筆 (共 {filteredData.length} 筆)
                     </div>
                  )}
                </div>
              </>
            )}
            
            {loading && data.length > 0 && (
               <div className="absolute inset-0 bg-white/50 backdrop-blur-[1px] flex items-center justify-center z-10 transition-opacity">
                  <div className="bg-white p-4 rounded-xl shadow-lg border border-gray-200 flex items-center gap-3">
                     <RefreshCcw className="w-5 h-5 text-indigo-600 animate-spin" />
                     <span className="font-medium text-gray-700">更新資料中...</span>
                  </div>
               </div>
            )}
          </div>
        </div>
      </main>

      {/* GAS Code Modal */}
      {showGasCode && (
         <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-3xl rounded-2xl shadow-xl border border-gray-200 overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-200">
               <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-gray-50">
                  <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                     <Code className="w-5 h-5 text-indigo-600" />
                     GAS 網頁應用程式部署程式碼
                  </h3>
                  <button onClick={() => setShowGasCode(false)} className="text-gray-400 hover:text-gray-600 p-1">
                     ✕
                  </button>
               </div>
               <div className="flex-1 overflow-y-auto p-6 bg-white space-y-6">
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800 leading-relaxed">
                     <p className="font-semibold mb-1 flex items-center gap-2">
                        <AlertCircle className="w-4 h-4" />
                        請更新您的 Apps Script
                     </p>
                     為了支援打開網頁時就載入所有資料、達到秒切工作表的效果，我們更新了程式碼，加入了 <code>action=getAllData</code> 的支援。請將下方完整的程式碼貼到 Apps Script 後，建立<strong>新的部署作業</strong>（或在原先的部署上選「新增版本」）以套用這個更新！
                  </div>
                  
                  <div className="bg-gray-900 rounded-xl border border-gray-800 shadow-inner overflow-hidden">
                     <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700 bg-gray-800/50">
                        <span className="text-gray-400 text-xs font-mono">Code.gs</span>
                        <button
                           onClick={copyToClipboard}
                           className="flex items-center gap-1.5 px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors rounded text-xs font-medium"
                        >
                           {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                           {copied ? '已複製！' : '複製全部'}
                        </button>
                     </div>
                     <pre className="text-green-400 text-xs sm:text-sm font-mono overflow-x-auto p-4 custom-scrollbar max-h-[40vh]">
                       <code>{gasCode}</code>
                     </pre>
                  </div>

                  <div>
                     <h4 className="font-bold text-gray-900 mb-2">部署教學：</h4>
                     <ol className="list-decimal pl-5 space-y-1.5 text-sm text-gray-600">
                        <li>前往試算表，點擊頂部選單 <strong className="text-gray-800">「擴充功能」 {'>'} 「Apps Script」</strong>。</li>
                        <li>刪除原有的程式碼，貼上上方複製的內容。</li>
                        <li>點擊右上方的 <strong className="text-gray-800">「部署」 {'>'} 「管理部署作業」</strong>（或「新增部署作業」）。</li>
                        <li>如果是管理部署作業，點擊右上角鉛筆（編輯），然後將「版本」選為 <strong className="text-gray-800">建立新版本</strong>。</li>
                        <li>按下 <strong className="text-gray-800">部署</strong>，即可完成更新！介面將自動抓取多個工作表。</li>
                     </ol>
                  </div>
               </div>
               <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex justify-end">
                  <button
                     onClick={() => setShowGasCode(false)}
                     className="px-5 py-2 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 shadow-sm transition-colors"
                  >
                     知道囉，關閉
                  </button>
               </div>
            </div>
         </div>
      )}
    </div>
  );
}
