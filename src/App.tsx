import React, { useState, useEffect, useMemo, useRef } from 'react';
import Papa from 'papaparse';
import { AlertCircle, RefreshCcw, Table2, Search, Code, Copy, CheckCircle2, ChevronRight, Menu, LayoutTemplate, LineChart, ExternalLink, FileText, Filter, Check, ArrowUp, ArrowDown, ArrowUpDown, Heart, LogOut, User, Columns, X } from 'lucide-react';
import { db, auth } from './lib/firebase';
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut, User as FirebaseUser } from 'firebase/auth';
import { collection, doc, setDoc, deleteDoc, getDocs, onSnapshot, serverTimestamp } from 'firebase/firestore';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}
function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

const getSymbol = (row: any): string => {
  if (!row) return '';
  return String(row['代碼'] || row['代號'] || row['現股代號'] || row['證券代號'] || row['公司代號'] || '').trim();
};

const getName = (row: any): string => {
  if (!row) return '';
  return String(row['名稱'] || row['公司名稱'] || row['股票名稱'] || row['證券名稱'] || '').trim();
};

const formatCellValue = (val: any): string => {
  if (val === null || val === undefined || val === '') return '';
  const strVal = String(val).trim();
  const numVal = Number(strVal);
  // Only format if it's a valid number with a decimal point and it doesn't end with '%'
  if (!isNaN(numVal) && strVal.includes('.') && !strVal.includes('%')) {
    // Math.round to 2 decimal places to remove floating point inaccuracies, 
    // then to string to remove unnecessary trailing zeros. But user requested '最多到0.00這個位數'
    // so we can use parseFloat and toFixed then parseFloat again to strip trailing zeroes.
    return parseFloat(numVal.toFixed(2)).toString();
  }
  return strVal;
};

const DEFAULT_API_URL = "https://script.google.com/macros/s/AKfycbyoKmgydF-B4Um-F07SmCvHOiHuufvRcLsnOGTS8QWKtP3869vYOkRYz-EOkcuPW1r1/exec";

const DATE_COLUMNS = ['發言日期', '發布日期', '日期', '年月', '資料年月', '公告月份', '月份', '發生日期', '發言時間'];

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
  const [selectedIntersectSheets, setSelectedIntersectSheets] = useState<string[]>([]);
  
  // Row Detail Modal
  const [selectedRowInfo, setSelectedRowInfo] = useState<Record<string, any> | null>(null);
  
  // GAS Code modal state
  const [showGasCode, setShowGasCode] = useState(false);
  const [copied, setCopied] = useState(false);

  // Month filter state
  const [selectedMonth, setSelectedMonth] = useState<string>("ALL");
  const [selectedStatus, setSelectedStatus] = useState<string>("ALL");

  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [authLoading, setAuthLoading] = useState(true);

  // Auth setup
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setAuthLoading(false);
    });
    return () => unsub();
  }, []);

  // Fetch favorites
  useEffect(() => {
    if (!currentUser) {
      setFavorites(new Set());
      return;
    }
    const path = `users/${currentUser.uid}/favorites`;
    const q = collection(db, path);
    const unsub = onSnapshot(q, (snapshot) => {
      const favs = new Set<string>();
      snapshot.docs.forEach(doc => favs.add(doc.data().symbol));
      setFavorites(favs);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, path);
    });
    return () => unsub();
  }, [currentUser]);

  const handleLogin = () => {
    signInWithPopup(auth, new GoogleAuthProvider()).catch(err => {
        console.error(err);
        if (err.code === 'auth/unauthorized-domain') {
            setError(`無法登入：此網域 (${window.location.hostname}) 尚未加入 Firebase 的授權網域清單。請至 Firebase 控制台 > Authentication > Settings > Authorized domains 加入此網域。`);
        } else {
            setError(`登入失敗： ${err.message}`);
        }
    });
  };

  const toggleFavorite = async (e: React.MouseEvent, row: any) => {
    e.stopPropagation();
    if (!currentUser) {
      handleLogin();
      return;
    }
    const symbol = getSymbol(row);
    const name = getName(row);
    if (!symbol) return;
    
    if (favorites.has(symbol)) {
      // Remove
      const docPath = `users/${currentUser.uid}/favorites/${symbol}`;
      try {
        await deleteDoc(doc(db, docPath));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, docPath);
      }
    } else {
      // Add
      const docPath = `users/${currentUser.uid}/favorites/${symbol}`;
      try {
        await setDoc(doc(db, docPath), {
          userId: currentUser.uid,
          symbol: String(symbol),
          name: name ? String(name) : '',
          createdAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, docPath);
      }
    }
  };

  useEffect(() => {
     setSelectedMonth("ALL");
  }, [selectedSheet]);

  const SHEET_DESCRIPTIONS: Record<string, string> = {
    '上市價量齊揚': '股價六天新高，成交量大於前一天30%',
    '上櫃價量齊揚': '股價六天新高，成交量大於前一天30%',
    '上市_值得注意': '股價六天新高，營收六個月新高',
    '上櫃_值得注意': '股價六天新高，營收六個月新高',
    '投信連買篩選': '投信至少連續買超三天，股本5~50億的股票',
    '主動型ETF每日差異': '全體曝險排行Top40'
  };
  const [needsGasUpdate, setNeedsGasUpdate] = useState(false);

  // You can still manually test another URL in code, but UI hides it.
  const apiUrl = DEFAULT_API_URL;

  const fetchSheets = async () => {
    setLoadingSheets(true);
    setLoading(true);
    setNeedsGasUpdate(false);
    try {
      const response = await fetch(`${apiUrl}?action=getSheets`);
      
      if (!response.ok) throw new Error(`API 請求失敗: ${response.statusText}`);
      const jsonData = await response.json();
      
      if (jsonData && jsonData.sheets) {
        // 先過濾掉不要顯示的工作表
        const originalSheetNames = jsonData.sheets as string[];
        const sheetNames = originalSheetNames.filter(name => name !== '上市櫃公司清單_含產業');
        
        setSheets(sheetNames);
        
        const targetSheet = selectedSheet && sheetNames.includes(selectedSheet) ? selectedSheet : (sheetNames[0] || "");
        if (!selectedSheet && targetSheet) {
          setSelectedSheet(targetSheet);
        }

        if (sheetNames.length > 0) {
           const initialSheets = [targetSheet];
           for (const name of sheetNames) {
              if (name !== targetSheet && initialSheets.length < 3) {
                 initialSheets.push(name);
              }
           }
           const remainingSheets = sheetNames.filter(name => !initialSheets.includes(name));

           const initialRes = await Promise.all(
              initialSheets.map(async (name) => {
                 try {
                   const res = await fetch(`${apiUrl}?sheetName=${encodeURIComponent(name)}`);
                   return { name, data: await res.json() };
                 } catch (e) {
                   return { name, data: { error: 'Fetch failed' } };
                 }
              })
           );

           const initialDataMap: Record<string, any[]> = {};
           for (const result of initialRes) {
              if (Array.isArray(result.data)) {
                 initialDataMap[result.name] = result.data;
              } else if (result.data && result.data.allData) {
                 // in case the backend somehow returned allData
                 Object.assign(initialDataMap, result.data.allData);
              } else {
                 initialDataMap[result.name] = [];
              }
           }
           setAllSheetsData(prev => ({ ...prev, ...initialDataMap }));
           
           // Loading is done for the initial view!
           setLoadingSheets(false);
           setLoading(false);

           // Fetch remaining in the background sequentially or concurrently
           remainingSheets.forEach((name) => {
              fetch(`${apiUrl}?sheetName=${encodeURIComponent(name)}`)
                 .then(res => res.json())
                 .then(data => {
                    if (Array.isArray(data)) {
                       setAllSheetsData(prev => ({ ...prev, [name]: data }));
                    }
                 })
                 .catch(err => console.error(`Background fetch error for ${name}`, err));
           });
        } else {
           setLoadingSheets(false);
           setLoading(false);
        }
      } else if (jsonData && jsonData.allData) {
        // Fallback if they still used action=getAllData directly
        setAllSheetsData(jsonData.allData);
        setSheets(jsonData.sheets || []);
        if (jsonData.sheets?.length > 0 && !selectedSheet) {
          setSelectedSheet(jsonData.sheets[0]);
        }
        setLoadingSheets(false);
        setLoading(false);
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
        setLoadingSheets(false);
        setLoading(false);
      } else {
        setError('API 回傳格式不正確');
        setLoadingSheets(false);
        setLoading(false);
      }
    } catch (err: any) {
      console.error("Fetch sheets error:", err);
      setError(`無法讀取工作表清單: ${err.message}`);
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
    if (selectedSheet === 'FAVORITES') {
       if (!currentUser) {
          setData([]);
          setColumns([]);
          return;
       }
       // Build data from allSheetsData finding favorites mapping by symbol
       const allRows = Object.values(allSheetsData).flat();
       // To dedup, maybe we just use standard fields like "代號" or "公司代號"
       const favData: any[] = [];
       // Also the favorite set itself has names:
       // We can simply show them if we can't find extra data, but let's try to map extra data if available
       const uniqueSymbols = Array.from(favorites);
       uniqueSymbols.forEach(symbol => {
          let row = allRows.find(r => getSymbol(r) === symbol);
          if (!row) {
             row = { '代號': symbol, '名稱': '' };
          }
          favData.push(row);
       });
       setData(favData);
       setColumns(favData.length > 0 ? Object.keys(favData[0]) : []);
       return;
    }
    if (selectedSheet && selectedSheet !== 'MULTI_FILTER' && !needsGasUpdate) {
      loadData(selectedSheet);
    }
  }, [selectedSheet, needsGasUpdate, favorites, currentUser]);

  useEffect(() => {
    if (selectedSheet === 'MULTI_FILTER') {
       if (selectedIntersectSheets.length === 0) {
           setData([]);
           setColumns([]);
           setError(null);
           return;
       }
       setError(null);
       
       const getFilteredSheetData = (sheetName: string) => {
           let sData = allSheetsData[sheetName] || [];
           if (selectedMonth !== "ALL" && ['財報_財務報告', '轉換公司債', '達公布注意交易資訊標準', '法說會_法人說明會'].includes(sheetName)) {
               const sheetCols = Object.keys(sData[0] || {});
               const targetCol = sheetCols.find(c => DATE_COLUMNS.includes(c)) || sheetCols.find(c => c.includes('日期') || c.includes('月'));
               if (targetCol) {
                   sData = sData.filter(row => {
                      const val = String(row[targetCol!] || '').trim();
                      return val.startsWith(selectedMonth) || val.includes(selectedMonth);
                   });
               }
           }
           if (selectedStatus !== "ALL" && sheetName === '月KD') {
               const sheetCols = Object.keys(sData[0] || {});
               const targetCol = sheetCols.find(c => c === '狀態' || c.includes('狀態'));
               if (targetCol) {
                   sData = sData.filter(row => {
                      const val = String(row[targetCol!] || '').trim();
                      return val === selectedStatus || val.includes(selectedStatus);
                   });
               }
           }
           return sData;
       };

       const dateSheetName = selectedIntersectSheets.find(s => ['財報_財務報告', '轉換公司債', '達公布注意交易資訊標準', '法說會_法人說明會'].includes(s));
       
       const baseSheet = dateSheetName || selectedIntersectSheets[0];
       const baseData = getFilteredSheetData(baseSheet);
       const otherSheets = selectedIntersectSheets.filter(s => s !== baseSheet);
       
       const otherSheetsSymbolSets = otherSheets.map(sheet => {
          const sData = getFilteredSheetData(sheet);
          return new Set(sData.map(row => getSymbol(row)).filter(Boolean));
       });

       const intersected = baseData.filter(row => {
          const id = getSymbol(row);
          if (!id) return false;
          return otherSheetsSymbolSets.every(set => set.has(id));
       });
       
       setData(intersected);
       setColumns(intersected.length > 0 ? Object.keys(intersected[0]) : []);
    }
  }, [selectedSheet, selectedIntersectSheets, allSheetsData, selectedMonth, selectedStatus]);

  const toggleIntersectSheet = (sheet: string) => {
    setSelectedIntersectSheets(prev => {
       if (prev.includes(sheet)) {
          return prev.filter(s => s !== sheet);
       } else {
          // Trigger fetch if not loaded
          if (!allSheetsData[sheet]) {
             setLoading(true);
             fetch(`${apiUrl}?sheetName=${encodeURIComponent(sheet)}`)
                 .then(res => res.json())
                 .then(fetchedData => {
                    if (Array.isArray(fetchedData)) {
                       setAllSheetsData(all => ({ ...all, [sheet]: fetchedData }));
                    }
                 })
                 .catch(err => console.error(`Fetch error for ${sheet}`, err))
                 .finally(() => setLoading(false));
          }
          return [...prev, sheet];
       }
    });
  };

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

  const hasDateSheet = selectedSheet === 'MULTI_FILTER' 
    ? selectedIntersectSheets.some(s => ['財報_財務報告', '轉換公司債', '達公布注意交易資訊標準', '法說會_法人說明會'].includes(s))
    : ['財報_財務報告', '轉換公司債', '達公布注意交易資訊標準', '法說會_法人說明會'].includes(selectedSheet || '');

  const availableMonths = useMemo(() => {
    if (!hasDateSheet) return [];
    
    // Find which sheet is the date sheet
    let dateSheetName = selectedSheet === 'MULTI_FILTER' 
       ? selectedIntersectSheets.find(s => ['財報_財務報告', '轉換公司債', '達公布注意交易資訊標準', '法說會_法人說明會'].includes(s))
       : selectedSheet;
       
    if (!dateSheetName) return [];
    
    const sheetData = allSheetsData[dateSheetName] || [];
    if (sheetData.length === 0) return [];
    
    const sheetCols = Object.keys(sheetData[0] || {});
    let targetCol = sheetCols.find(c => DATE_COLUMNS.includes(c)) || sheetCols.find(c => c.includes('日期') || c.includes('月'));
    if (!targetCol) return [];

    const months = new Set<string>();
    sheetData.forEach(row => {
       const val = row[targetCol!];
       if (val) {
          const strVal = String(val).trim();
          const matchDate = strVal.match(/^(\d{2,4}[/-]\d{1,2})/);
          if (matchDate) {
             months.add(matchDate[1]);
          } else if (strVal.match(/^\d{2,4}年\d{1,2}月/)) {
             const m = strVal.match(/^(\d{2,4}年\d{1,2}月)/);
             if (m) months.add(m[1]);
          } else if (strVal.match(/^\d{3,4}\/?\d{2}$/)) {
             months.add(strVal);
          }
       }
    });
    return Array.from(months).sort((a, b) => b.localeCompare(a));
  }, [selectedSheet, selectedIntersectSheets, allSheetsData, hasDateSheet]);

  const hasStatusSheet = selectedSheet === 'MULTI_FILTER'
    ? selectedIntersectSheets.some(s => s === '月KD')
    : selectedSheet === '月KD';

  const availableStatuses = useMemo(() => {
     if (!hasStatusSheet) return [];
     let statusSheetName = selectedSheet === 'MULTI_FILTER'
       ? selectedIntersectSheets.find(s => s === '月KD')
       : selectedSheet;
     if (!statusSheetName) return [];
     const sheetData = allSheetsData[statusSheetName] || [];
     if (sheetData.length === 0) return [];
     const sheetCols = Object.keys(sheetData[0] || {});
     let targetCol = sheetCols.find(c => c === '狀態' || c.includes('狀態'));
     if (!targetCol) return [];
     const statuses = new Set<string>();
     sheetData.forEach(row => {
         const val = row[targetCol!];
         if (val !== undefined && val !== null && val !== '') {
             statuses.add(String(val).trim());
         }
     });
     return Array.from(statuses).sort();
  }, [selectedSheet, selectedIntersectSheets, allSheetsData, hasStatusSheet]);

   const isCBRadar = selectedSheet === '轉換公司債' || selectedIntersectSheets.includes('轉換公司債') || selectedSheet === 'CB可轉債雷達' || selectedIntersectSheets.includes('CB可轉債雷達');
   const stickyColCount = isCBRadar ? 3 : 2;
   const stickyColWidths = [140, 160, 140];

   const getStickyStyles = (idx: number) => {
      if (idx >= stickyColCount) return {};
      let left = 0;
      for (let i = 0; i < idx; i++) {
          left += stickyColWidths[i];
      }
      return {
          left: `${left}px`,
          minWidth: `${stickyColWidths[idx]}px`,
          maxWidth: `${stickyColWidths[idx]}px`,
          width: `${stickyColWidths[idx]}px`,
      };
   };
   
  const visibleSheets = useMemo(() => {
    return sheets.filter(sheet => {
      // 排除「上市櫃公司清單_含產業」
      if (sheet === '上市櫃公司清單_含產業') return false;
      // 如果已經載入且沒有資料則隱藏
      if (allSheetsData[sheet] && allSheetsData[sheet].length === 0) return false;
      return true;
    });
  }, [sheets, allSheetsData]);

  // 如果選擇的工作表被隱藏了，自動切換到第一個可見的工作表
  useEffect(() => {
    if (selectedSheet && selectedSheet !== 'MULTI_FILTER' && selectedSheet !== 'FAVORITES') {
      if (visibleSheets.length > 0 && !visibleSheets.includes(selectedSheet)) {
        if (allSheetsData[selectedSheet] && allSheetsData[selectedSheet].length === 0) {
           setSelectedSheet(visibleSheets[0]);
        }
      }
    }
    
    // 如果有被隱藏的工作表在交集名單中，自動移除
    if (selectedIntersectSheets.some(sheet => allSheetsData[sheet] && allSheetsData[sheet].length === 0)) {
        setSelectedIntersectSheets(prev => prev.filter(sheet => !allSheetsData[sheet] || allSheetsData[sheet].length > 0));
    }
    // 也排除「上市櫃公司清單_含產業」
    if (selectedIntersectSheets.includes('上市櫃公司清單_含產業')) {
        setSelectedIntersectSheets(prev => prev.filter(sheet => sheet !== '上市櫃公司清單_含產業'));
    }
  }, [selectedSheet, visibleSheets, allSheetsData, selectedIntersectSheets]);

  const filteredData = useMemo(() => {
    let result = data;
    
    if (selectedSheet !== 'MULTI_FILTER' && selectedMonth !== "ALL" && hasDateSheet) {
       let targetCol = columns.find(c => DATE_COLUMNS.includes(c)) || columns.find(c => c.includes('日期') || c.includes('月'));
       if (targetCol) {
          result = result.filter(row => {
             const val = String(row[targetCol!] || '').trim();
             return val.startsWith(selectedMonth) || val.includes(selectedMonth);
          });
       }
    }

    if (selectedSheet !== 'MULTI_FILTER' && selectedStatus !== "ALL" && hasStatusSheet) {
       let targetCol = columns.find(c => c === '狀態' || c.includes('狀態'));
       if (targetCol) {
          result = result.filter(row => {
             const val = String(row[targetCol!] || '').trim();
             return val === selectedStatus || val.includes(selectedStatus);
          });
       }
    }

    if (!searchTerm) return result;
    const lowerSearch = searchTerm.toLowerCase();
    return result.filter(row => 
      columns.some(col => {
         const val = row[col];
         return val !== null && val !== undefined && String(val).toLowerCase().includes(lowerSearch);
      })
    );
  }, [data, columns, searchTerm, selectedMonth, selectedStatus, hasDateSheet, hasStatusSheet, selectedSheet]);

  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [showColumnSelector, setShowColumnSelector] = useState(false);
  const pageSize = 100;

  useEffect(() => {
     setCurrentPage(1);
  }, [selectedSheet, selectedIntersectSheets, selectedMonth, selectedStatus, searchTerm, sortConfig]);

  useEffect(() => {
     setHiddenColumns(new Set());
  }, [selectedSheet, selectedIntersectSheets]);

  const toggleColumnVisibility = (col: string) => {
     setHiddenColumns(prev => {
        const next = new Set(prev);
        if (next.has(col)) {
           next.delete(col);
        } else {
           next.add(col);
        }
        return next;
     });
  };

  const visibleColumns = useMemo(() => {
      return columns.filter(c => !hiddenColumns.has(c));
  }, [columns, hiddenColumns]);

  const handleSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    } else if (sortConfig && sortConfig.key === key && sortConfig.direction === 'desc') {
      // Third click removes sorting, or we can just toggle back to asc. Let's toggle between asc and desc, or clear it.
      // Usually users prefer toggling: asc -> desc -> null
      setSortConfig(null);
      return;
    }
    setSortConfig({ key, direction });
  };

  const sortedData = useMemo(() => {
    let sortableItems = [...filteredData];
    if (sortConfig !== null) {
      sortableItems.sort((a, b) => {
        let aValue = a[sortConfig.key];
        let bValue = b[sortConfig.key];
        
        // Handle nulls/undefined
        if (aValue === null || aValue === undefined || aValue === '') return sortConfig.direction === 'asc' ? 1 : -1;
        if (bValue === null || bValue === undefined || bValue === '') return sortConfig.direction === 'asc' ? -1 : 1;
        
        // Custom sort orders
        if (sortConfig.key.includes('本益比狀態')) {
           const aStr = String(aValue);
           const bStr = String(bValue);
           const getPeOrder = (val: string) => {
              if (val.includes('高估')) return 5;
              if (val.includes('略高')) return 4;
              if (val.includes('合理')) return 3;
              if (val.includes('低估')) return 2;
              if (val.includes('NA')) return 1;
              return 0;
           };
           const aOrder = getPeOrder(aStr);
           const bOrder = getPeOrder(bStr);
           if (aOrder !== bOrder) {
               return sortConfig.direction === 'asc' ? aOrder - bOrder : bOrder - aOrder;
           }
        }

        if (sortConfig.key.includes('乖離率狀態')) {
           const aStr = String(aValue);
           const bStr = String(bValue);
           const getBiasOrder = (val: string) => {
              if (val.includes('瘋狂')) return 5;
              if (val.includes('過熱')) return 4;
              if (val.includes('正常')) return 3;
              if (val.includes('極度超賣')) return 1; // MUST PRECEED 超賣
              if (val.includes('超賣')) return 2;
              return 0;
           };
           const aOrder = getBiasOrder(aStr);
           const bOrder = getBiasOrder(bStr);
           if (aOrder !== bOrder) {
               return sortConfig.direction === 'asc' ? aOrder - bOrder : bOrder - aOrder;
           }
        }

        // Try parsing to number
        const aNum = Number(aValue);
        const bNum = Number(bValue);
        const isNumeric = !isNaN(aNum) && !isNaN(bNum);

        if (isNumeric) {
           return sortConfig.direction === 'asc' ? aNum - bNum : bNum - aNum;
        }

        // Try parsing as percentage if it contains %
        if (typeof aValue === 'string' && typeof bValue === 'string' && aValue.includes('%') && bValue.includes('%')) {
           const aPct = parseFloat(aValue.replace(/%/g, ''));
           const bPct = parseFloat(bValue.replace(/%/g, ''));
           if (!isNaN(aPct) && !isNaN(bPct)) {
              return sortConfig.direction === 'asc' ? aPct - bPct : bPct - aPct;
           }
        }

        // Fallback to string comparison
        aValue = String(aValue).toLowerCase();
        bValue = String(bValue).toLowerCase();
        
        if (aValue < bValue) {
          return sortConfig.direction === 'asc' ? -1 : 1;
        }
        if (aValue > bValue) {
          return sortConfig.direction === 'asc' ? 1 : -1;
        }
        return 0;
      });
    }
    return sortableItems;
  }, [filteredData, sortConfig]);

  if (loadingSheets && Object.keys(allSheetsData).length === 0 && !error) {
    return (
      <div className="flex h-[100dvh] w-full bg-indigo-50/30 flex-col items-center justify-center font-sans animate-in fade-in duration-500">
        <div className="flex flex-col items-center animate-pulse">
          <div className="w-20 h-20 bg-indigo-100 rounded-3xl flex items-center justify-center mb-8 shadow-sm">
            <Table2 className="w-10 h-10 text-indigo-600" />
          </div>
          <h2 className="text-3xl font-bold text-gray-900 mb-3 tracking-tight">股票資料庫</h2>
          <p className="text-gray-500 text-base mb-8 text-center max-w-sm">正在從 Google 試算表同步資料，請稍候...</p>
          <div className="flex gap-2.5 items-center text-indigo-600 font-medium bg-indigo-50 px-5 py-2.5 rounded-full shadow-sm">
             <RefreshCcw className="w-5 h-5 animate-spin" />
             <span className="text-sm">載入中...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden text-gray-900 font-sans">
      
      {/* Mobile Sidebar Backdrop */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-gray-900/50 z-20 md:hidden transition-opacity" 
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside 
        className={`fixed md:relative inset-y-0 left-0 z-30 shrink-0 bg-white border-r border-gray-200 transition-all duration-300 flex flex-col overflow-hidden shadow-sm ${
          isSidebarOpen ? 'translate-x-0 w-64' : '-translate-x-full md:translate-x-0 md:w-0 w-64'
        }`}
      >
        <div className="h-16 flex items-center px-4 border-b border-gray-200 shrink-0">
          <div className="flex items-center gap-2 text-indigo-600">
             <Table2 className="w-6 h-6" />
             <span className="font-bold text-lg whitespace-nowrap">股票資料庫</span>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
          <div className="mb-4">
             <button
               onClick={() => {
                 if (selectedSheet === 'MULTI_FILTER') {
                    setSelectedSheet(visibleSheets.length > 0 ? visibleSheets[0] : null);
                 } else {
                    setSelectedSheet('MULTI_FILTER');
                    if (window.innerWidth < 768) setIsSidebarOpen(false);
                 }
               }}
               className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-all duration-200 ${
                 selectedSheet === 'MULTI_FILTER'
                   ? "bg-indigo-600 text-white shadow-md shadow-indigo-200 font-medium"
                   : "text-gray-600 hover:bg-indigo-50 hover:text-indigo-600"
               }`}
             >
               <div className="flex items-center gap-2">
                 <div className={`p-1 rounded-md ${selectedSheet === 'MULTI_FILTER' ? 'bg-indigo-500 text-white' : 'bg-indigo-50 text-indigo-500'}`}>
                    <Filter className="w-4 h-4" />
                 </div>
                 <span className="truncate">多重條件交集</span>
               </div>
               {selectedSheet === 'MULTI_FILTER' && <ChevronRight className="w-4 h-4 text-indigo-200" />}
             </button>
          </div>

          <div className="mb-4">
             <button
               onClick={() => {
                 if (selectedSheet !== 'FAVORITES') {
                    setSelectedSheet('FAVORITES');
                    if (window.innerWidth < 768) setIsSidebarOpen(false);
                 }
               }}
               className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-all duration-200 ${
                 selectedSheet === 'FAVORITES'
                   ? "bg-pink-600 text-white shadow-md shadow-pink-200 font-medium"
                   : "text-gray-600 hover:bg-pink-50 hover:text-pink-600"
               }`}
             >
               <div className="flex items-center gap-2">
                 <div className={`p-1 rounded-md ${selectedSheet === 'FAVORITES' ? 'bg-pink-500 text-white' : 'bg-pink-50 text-pink-500'}`}>
                    <Heart className="w-4 h-4" />
                 </div>
                 <span className="truncate">自選股</span>
               </div>
               {selectedSheet === 'FAVORITES' && <ChevronRight className="w-4 h-4 text-pink-200" />}
             </button>
          </div>

          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 px-2">工作表清單</h3>
          
          <ul className="space-y-1">
            {visibleSheets.map(sheet => {
              const isIntersectSelected = selectedSheet === 'MULTI_FILTER' && selectedIntersectSheets.includes(sheet);
              return (
              <li key={sheet}>
                <button
                  onClick={() => {
                      if (selectedSheet === 'MULTI_FILTER') {
                         toggleIntersectSheet(sheet);
                      } else {
                         setSelectedSheet(sheet);
                         if (window.innerWidth < 768) setIsSidebarOpen(false);
                      }
                  }}
                  className={`group w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-colors cursor-pointer ${
                    selectedSheet === sheet 
                      ? 'bg-indigo-50 text-indigo-700 font-medium' 
                      : isIntersectSelected
                      ? 'bg-indigo-50 text-indigo-600 font-medium'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                  }`}
                >
                   <span className="truncate py-0.5">{sheet}</span>
                   {selectedSheet === 'MULTI_FILTER' ? (
                       <div className={`w-4 h-4 rounded shadow-sm flex items-center justify-center shrink-0 border transition-all ${isIntersectSelected ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-gray-300 bg-white group-hover:border-indigo-400'}`}>
                          {isIntersectSelected && <Check className="w-3 h-3" />}
                       </div>
                   ) : (
                       selectedSheet === sheet && <ChevronRight className="w-4 h-4 text-indigo-500 mr-1" />
                   )}
                </button>
              </li>
            )})}
          </ul>
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
               {selectedSheet === 'MULTI_FILTER' ? "多重條件交集" : (selectedSheet || "載入中...")}
            </h2>
          </div>
          
          <div className="flex items-center gap-2 sm:gap-3">
             <div className="mr-2 sm:mr-4 flex items-center">
                 {!authLoading && (
                   currentUser ? (
                      <div className="flex items-center gap-3 bg-white/50 px-3 py-1.5 rounded-full border border-gray-200 shadow-sm">
                         {currentUser.photoURL ? (
                            <img src={currentUser.photoURL} alt="User" className="w-6 h-6 rounded-full" referrerPolicy="no-referrer" />
                         ) : (
                            <div className="w-6 h-6 bg-indigo-100 rounded-full flex items-center justify-center">
                              <User className="w-4 h-4 text-indigo-600" />
                            </div>
                         )}
                         <span className="text-sm font-medium text-gray-700 hidden sm:block max-w-[120px] truncate">
                            {currentUser.displayName || currentUser.email}
                         </span>
                         <button 
                            onClick={() => signOut(auth)}
                            className="p-1 text-gray-400 hover:text-red-500 transition-colors tooltip"
                            title="登出"
                         >
                            <LogOut className="w-4 h-4" />
                         </button>
                      </div>
                   ) : (
                      <button
                        onClick={handleLogin}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors shadow-sm"
                      >
                         <User className="w-4 h-4" />
                         <span>登入以啟用自選股</span>
                      </button>
                   )
                 )}
             </div>
             <button
               onClick={() => selectedSheet && selectedSheet !== 'MULTI_FILTER' ? loadData(selectedSheet, true) : fetchSheets()}
               disabled={loading}
               className="inline-flex items-center gap-1.5 px-3 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors shadow-sm disabled:opacity-50"
             >
                <RefreshCcw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                <span className="hidden sm:inline">重新整理</span>
             </button>
          </div>
        </header>

        <div className="flex-1 flex flex-col p-4 sm:p-6 bg-gray-50 overflow-y-auto md:overflow-hidden space-y-4 sm:space-y-6 custom-scrollbar">
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
                {selectedSheet === 'MULTI_FILTER' && (
                  <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm animate-in fade-in shrink-0">
                    <h3 className="text-base font-semibold text-gray-900 mb-3 flex items-center gap-2">
                      <Filter className="w-5 h-5 text-indigo-500" />
                      選擇要交集的工作表
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {visibleSheets.map(sheet => {
                          const isSelected = selectedIntersectSheets.includes(sheet);
                          return (
                            <button
                                key={sheet}
                                onClick={() => toggleIntersectSheet(sheet)}
                                className={`px-4 py-2 rounded-full text-sm font-medium border transition-colors ${
                                  isSelected 
                                    ? 'bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100' 
                                    : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                                }`}
                            >
                              <div className="flex items-center gap-1.5">
                                {isSelected && <Check className="w-3.5 h-3.5" />}
                                {sheet}
                              </div>
                            </button>
                          );
                      })}
                    </div>
                  </div>
                )}
                {selectedSheet === 'FAVORITES' && (
                  <div className="bg-pink-50 border border-pink-100 rounded-xl p-4 shadow-sm flex items-start gap-3 animate-in fade-in shrink-0">
                    <div className="bg-pink-100 text-pink-600 rounded-full p-1 shrink-0 mt-0.5">
                       <AlertCircle className="w-4 h-4" />
                    </div>
                    <div>
                        <h4 className="text-sm font-semibold text-pink-900 mb-0.5">自選股名單說明</h4>
                        <p className="text-pink-800 text-sm leading-relaxed">如果自選股掉出目前資料庫，它的財務數據、當前股價等欄位，可能會顯示為空白或無資料，直到這支股票重新回到資料庫。</p>
                    </div>
                  </div>
                )}
                {selectedSheet && selectedSheet !== 'MULTI_FILTER' && selectedSheet !== 'FAVORITES' && SHEET_DESCRIPTIONS[selectedSheet] && (
                  <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 shadow-sm flex items-start gap-3 animate-in fade-in shrink-0">
                    <div className="bg-indigo-100 text-indigo-600 rounded-full p-1 shrink-0 mt-0.5">
                       <AlertCircle className="w-4 h-4" />
                    </div>
                    <div>
                        <h4 className="text-sm font-semibold text-indigo-900 mb-0.5">工作表說明</h4>
                        <p className="text-indigo-800 text-sm leading-relaxed">{SHEET_DESCRIPTIONS[selectedSheet]}</p>
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4 shrink-0">
                    <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm col-span-1">
                        <h3 className="text-sm font-medium text-gray-500">總資料筆數</h3>
                        <p className="text-3xl font-bold mt-1 text-gray-900">{data.length}</p>
                    </div>
                    <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm col-span-1">
                        <h3 className="text-sm font-medium text-gray-500">資料欄位數</h3>
                        <p className="text-3xl font-bold mt-1 text-gray-900">{columns.length}</p>
                    </div>
                    
                    <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm col-span-1 md:col-span-2 flex items-center gap-3">
                        {availableMonths.length > 0 && (
                            <select
                                value={selectedMonth}
                                onChange={(e) => setSelectedMonth(e.target.value)}
                                className="block w-32 md:w-40 py-2.5 px-3 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all shadow-inner"
                            >
                                <option value="ALL">全部月份</option>
                                {availableMonths.map(m => (
                                    <option key={m} value={m}>{m}</option>
                                ))}
                            </select>
                        )}
                        {availableStatuses.length > 0 && (
                            <select
                                value={selectedStatus}
                                onChange={(e) => setSelectedStatus(e.target.value)}
                                className="block w-32 md:w-40 py-2.5 px-3 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all shadow-inner"
                            >
                                <option value="ALL">全部狀態</option>
                                {availableStatuses.map(s => (
                                    <option key={s} value={s}>{s}</option>
                                ))}
                            </select>
                        )}
                        <div className="flex-1 relative">
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
                        
                        <div className="relative">
                            <button
                                onClick={() => setShowColumnSelector(!showColumnSelector)}
                                className="flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                title="自訂欄位顯示"
                            >
                                <Columns className="w-4 h-4" />
                                <span className="hidden sm:inline">顯示欄位</span>
                            </button>
                            {showColumnSelector && (
                                <>
                                    <div className="fixed inset-0 z-40" onClick={() => setShowColumnSelector(false)}></div>
                                    <div className="absolute right-0 mt-2 w-56 lg:w-64 bg-white rounded-xl shadow-xl border border-gray-200 z-50 overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
                                        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
                                            <span className="font-semibold text-gray-900 text-sm">自訂欄位顯示</span>
                                            <button onClick={() => setShowColumnSelector(false)} className="text-gray-400 hover:text-gray-700 bg-white hover:bg-gray-200 rounded-full p-1 transition-colors">
                                                <X className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                        <div className="max-h-[60vh] md:max-h-[300px] overflow-y-auto p-2 flex flex-col gap-0.5 custom-scrollbar">
                                            {columns.map((col, idx) => {
                                                const isSticky = idx < stickyColCount;
                                                return (
                                                <label key={col} className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${isSticky ? 'opacity-50 cursor-not-allowed bg-gray-50 text-gray-400' : 'hover:bg-indigo-50 text-gray-700'}`}>
                                                    <input 
                                                        type="checkbox" 
                                                        checked={isSticky ? true : !hiddenColumns.has(col)}
                                                        onChange={() => !isSticky && toggleColumnVisibility(col)}
                                                        disabled={isSticky}
                                                        className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500 disabled:opacity-50"
                                                    />
                                                    <span className="text-sm select-none truncate font-medium">{col}</span>
                                                    {isSticky && <span className="ml-auto text-[10px] text-gray-400 font-semibold bg-gray-200 px-1.5 py-0.5 rounded">固定表頭</span>}
                                                </label>
                                            )})}
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex flex-col shrink-0 min-h-[300px] max-h-[600px] md:max-h-none md:h-auto md:flex-1 md:min-h-0">
                    <div className="overflow-auto custom-scrollbar flex-1 relative">
                    <table className="w-full text-sm text-left">
                      <thead className="text-xs text-gray-600 uppercase bg-gray-50 border-b border-gray-200">
                        <tr>
                          {visibleColumns.map((col, idx) => (
                            <th 
                                key={col} 
                                onClick={() => handleSort(col)}
                                className={`px-5 py-3.5 font-semibold whitespace-nowrap border-b border-gray-200 border-r border-gray-100 last:border-0 hover:bg-gray-200/60 cursor-pointer select-none group sticky top-0 bg-gray-50 ${idx < stickyColCount ? 'z-30 hover:bg-gray-200/100 shadow-[1px_0_0_0_#f3f4f6]' : 'z-20 shadow-sm'}`}
                                style={getStickyStyles(idx)}
                            >
                                <div className="flex items-center gap-1.5">
                                  {col}
                                  {sortConfig?.key === col ? (
                                     sortConfig.direction === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-indigo-600" /> : <ArrowDown className="w-3.5 h-3.5 text-indigo-600" />
                                  ) : (
                                     <ArrowUpDown className="w-3 h-3 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                                  )}
                                </div>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {loading && data.length === 0 ? (
                           <tr>
                              <td colSpan={visibleColumns.length || 1} className="px-6 py-20 text-center">
                                 <RefreshCcw className="w-8 h-8 text-indigo-400 animate-spin mx-auto mb-3" />
                                 <p className="text-gray-500 text-sm">正在載入資料...</p>
                              </td>
                           </tr>
                        ) : selectedSheet === 'MULTI_FILTER' && selectedIntersectSheets.length === 0 ? (
                           <tr>
                              <td colSpan={visibleColumns.length || 1} className="px-6 py-20 text-center">
                                 <Filter className="w-12 h-12 text-indigo-200 mx-auto mb-4" />
                                 <p className="text-gray-500 text-lg">請選擇至少一個工作表</p>
                              </td>
                           </tr>
                        ) : sortedData.length > 0 ? (
                            sortedData.slice((currentPage - 1) * pageSize, currentPage * pageSize).map((row, rowIdx) => (
                            <tr 
                                key={rowIdx} 
                                onClick={() => setSelectedRowInfo(row)}
                                className="hover:bg-indigo-50/40 transition-colors cursor-pointer group"
                            >
                                {visibleColumns.map((col, colIdx) => {
                                const cellValue = row[col];
                                const formattedValue = formatCellValue(cellValue);
                                const isNumericStr = !isNaN(Number(cellValue)) && cellValue !== '' && cellValue !== null;
                                const isNegative = isNumericStr && Number(cellValue) < 0;
                                const isPositive = isNumericStr && Number(cellValue) > 0;
                                
                                return (
                                    <td 
                                        key={col} 
                                        className={`px-5 py-3 max-w-[200px] truncate border-r border-gray-50 last:border-0 ${
                                            isNegative ? 'text-rose-600' : 
                                            isPositive ? 'text-emerald-600' : 
                                            'text-gray-700'
                                        } ${colIdx < stickyColCount ? 'sticky bg-white shadow-[1px_0_0_0_#f9fafb] z-10 group-hover:bg-indigo-50/90' : ''}`}
                                        title={String(formattedValue || '')}
                                        style={getStickyStyles(colIdx)}
                                    >
                                        {colIdx === 0 ? (
                                           <div className="flex items-center gap-2">
                                              <button 
                                                 onClick={(e) => toggleFavorite(e, row)}
                                                 className={`p-1 rounded-full transition-colors ${
                                                    favorites.has(getSymbol(row))
                                                      ? 'text-pink-500 hover:bg-pink-100'
                                                      : 'text-gray-300 hover:text-pink-400 hover:bg-pink-50'
                                                 }`}
                                                 title="加入自選"
                                              >
                                                <Heart className="w-4 h-4" fill={favorites.has(getSymbol(row)) ? "currentColor" : "none"} />
                                              </button>
                                              <span className="truncate">{formattedValue || '-'}</span>
                                           </div>
                                        ) : (
                                           formattedValue || '-'
                                        )}
                                    </td>
                                )
                                })}
                            </tr>
                            ))
                        ) : (
                            <tr>
                                <td colSpan={Math.max(visibleColumns.length, 1)} className="px-6 py-16 text-center text-gray-500">
                                    <LayoutTemplate className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                                    <p>找不到符合的資料</p>
                                </td>
                            </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  {sortedData.length > 0 && (
                     <div className="flex items-center justify-between p-4 bg-white border-t border-gray-200 shrink-0">
                         <div className="text-sm text-gray-500">
                             顯示 {(currentPage - 1) * pageSize + 1} 至 {Math.min(currentPage * pageSize, sortedData.length)} 筆，共 <span className="font-medium text-gray-900">{sortedData.length}</span> 筆
                         </div>
                         <div className="flex gap-2">
                             <button 
                                 onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                 disabled={currentPage === 1}
                                 className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
                             >
                                 上一頁
                             </button>
                             <button 
                                 onClick={() => setCurrentPage(p => Math.min(Math.ceil(sortedData.length / pageSize), p + 1))}
                                 disabled={currentPage === Math.ceil(sortedData.length / pageSize) || Math.ceil(sortedData.length / pageSize) === 0}
                                 className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
                             >
                                 下一頁
                             </button>
                         </div>
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
      </main>

      {/* Row Detail Modal for Mobile / Deep View */}
      {selectedRowInfo && (
         <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm z-50 flex flex-col items-center justify-end md:justify-center p-0 md:p-4 animate-in fade-in duration-200">
            <div 
               className="bg-white w-full md:max-w-xl rounded-t-3xl md:rounded-2xl shadow-xl flex flex-col md:max-h-[85vh] max-h-[90vh] animate-in slide-in-from-bottom-8 md:zoom-in-95 duration-300"
            >
               <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-white rounded-t-3xl md:rounded-t-2xl sticky top-0 z-10">
                  <div className="flex items-center gap-3 w-full pr-4 overflow-hidden">
                     <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2 truncate shrink">
                        {getName(selectedRowInfo) || getSymbol(selectedRowInfo) || selectedRowInfo[columns[0]] || '詳細資訊'}
                     </h3>
                     {getSymbol(selectedRowInfo) && (
                        <div className="flex items-center gap-2 overflow-x-auto hide-scrollbar pb-1 -mb-1">
                           <a 
                              href={`https://tw.stock.yahoo.com/quote/${getSymbol(selectedRowInfo)}/technical-analysis`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 border border-indigo-100 rounded-lg transition-colors shrink-0"
                              title="查看 Yahoo 奇摩股市技術線圖"
                           >
                              <LineChart className="w-4 h-4" />
                              <span>技術線圖</span>
                              <ExternalLink className="w-3.5 h-3.5 ml-0.5 opacity-70" />
                           </a>
                           {hasDateSheet && (
                              <a 
                                 href={`https://mops.twse.com.tw/mops/#/web/t146sb05?companyId=${getSymbol(selectedRowInfo)}`}
                                 target="_blank"
                                 rel="noopener noreferrer"
                                 className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-emerald-600 bg-emerald-50 hover:bg-emerald-100 border border-emerald-100 rounded-lg transition-colors shrink-0"
                                 title="查看公開資訊觀測站公告"
                              >
                                 <FileText className="w-4 h-4" />
                                 <span>觀測站公告</span>
                                 <ExternalLink className="w-3.5 h-3.5 ml-0.5 opacity-70" />
                              </a>
                           )}
                        </div>
                     )}
                  </div>
                  <button 
                     onClick={() => setSelectedRowInfo(null)} 
                     className="text-gray-400 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 rounded-full p-2 transition-colors shrink-0 ml-2"
                  >
                     ✕
                  </button>
               </div>
               
               <div className="flex-1 overflow-y-auto p-6 bg-gray-50/50 custom-scrollbar">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                     {columns.map((col, idx) => {
                        const cellValue = selectedRowInfo[col];
                        const formattedValue = formatCellValue(cellValue);
                        const isNumericStr = !isNaN(Number(cellValue)) && cellValue !== '' && cellValue !== null;
                        const isNegative = isNumericStr && Number(cellValue) < 0;
                        const isPositive = isNumericStr && Number(cellValue) > 0;
                        
                        return (
                           <div key={idx} className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm flex flex-col gap-1">
                              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{col}</span>
                              <span className={`text-base font-medium break-words ${
                                 isNegative ? 'text-rose-600' : 
                                 isPositive ? 'text-emerald-600' : 
                                 'text-gray-900'
                              }`}>
                                 {formattedValue || '-'}
                              </span>
                           </div>
                        );
                     })}
                  </div>
               </div>
               
               <div className="px-6 py-4 border-t border-gray-100 bg-white flex justify-end shrink-0 rounded-b-2xl">
                  <button
                     onClick={() => setSelectedRowInfo(null)}
                     className="w-full md:w-auto px-6 py-2.5 bg-gray-900 text-white font-medium rounded-xl hover:bg-gray-800 shadow-sm transition-colors active:scale-[0.98]"
                  >
                     關閉
                  </button>
               </div>
            </div>
         </div>
      )}

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
