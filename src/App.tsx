import React, { useState, useEffect, useMemo, useRef } from 'react';
import Papa from 'papaparse';
import { AlertCircle, RefreshCcw, Table2, Search, Code, Copy, CheckCircle2, ChevronRight, Menu, LayoutTemplate, LineChart, ExternalLink, FileText, Filter, Check, ArrowUp, ArrowDown, ArrowUpDown, Heart, LogOut, User, Columns, X, Download, Bookmark, BookmarkPlus, Trash2, BarChart3, PieChart, Building, Sun, Moon, ChevronDown, ChevronUp, GripVertical, TrendingUp, TrendingDown, Trophy } from 'lucide-react';
import { db, auth } from './lib/firebase';
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut, User as FirebaseUser } from 'firebase/auth';
import { collection, doc, setDoc, deleteDoc, getDocs, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend, LineChart as RechartsLineChart, Line } from 'recharts';
import Markdown from 'react-markdown';
import { InstitutionalRanking } from './components/InstitutionalRanking';

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
  return String(row['代碼'] || row['代號'] || row['現股代號'] || row['證券代號'] || row['公司代號'] || row['基金代號'] || row['ETF代碼'] || row['ETF代號'] || '').trim();
};

const getName = (row: any): string => {
  if (!row) return '';
  return String(row['名稱'] || row['公司名稱'] || row['股票名稱'] || row['證券名稱'] || row['ETF名稱'] || row['基金名稱'] || '').trim();
};

const formatCellValue = (val: any): string => {
  if (val === null || val === undefined || val === '') return '';
  const strVal = String(val).trim();
  const numVal = Number(strVal);
  // Only format if it's a valid number with a decimal point and it doesn't end with '%'
  if (!isNaN(numVal) && strVal.includes('.') && !strVal.includes('%')) {
    // 只要顯示0.00位數就好了
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
  
  // Dark Mode State
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('theme') === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches);
    }
    return false;
  });

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDarkMode]);

  // Sidebar & Sheets State
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' ? window.innerWidth < 768 : false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => typeof window !== 'undefined' ? window.innerWidth >= 768 : true);
  const [isIntersectCollapsed, setIsIntersectCollapsed] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const handleResize = () => setIsMobile(window.innerWidth < 768);
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
    }
  }, []);
  const [sheets, setSheets] = useState<string[]>([]);
  const [allSheetsData, setAllSheetsData] = useState<Record<string, any[]>>({});
  const [selectedSheet, setSelectedSheet] = useState<string | null>(null);
  const [loadingSheets, setLoadingSheets] = useState(false);
  const [selectedIntersectSheets, setSelectedIntersectSheets] = useState<string[]>([]);
  
  // Row Detail Modal
  const [selectedRowInfo, setSelectedRowInfo] = useState<Record<string, any> | null>(null);

  const getOrderedSheets = (apiSheets: string[]) => {
      try {
         const saved = localStorage.getItem('sheetOrder');
         if (saved) {
            const savedOrder = JSON.parse(saved) as string[];
            const ordered = savedOrder.filter(s => apiSheets.includes(s));
            const newSheets = apiSheets.filter(s => !ordered.includes(s));
            return [...ordered, ...newSheets];
         }
      } catch (e) {}
      return apiSheets;
  };
  
  // GAS Code modal state
  const [showGasCode, setShowGasCode] = useState(false);
  const [copied, setCopied] = useState(false);

  const [lastFetchTime, setLastFetchTime] = useState<Date | null>(null);

  // Month filter state
  const [selectedDashboardDate, setSelectedDashboardDate] = useState<string>("NEWEST");
  
  useEffect(() => {
      setSelectedDashboardDate("NEWEST");
  }, [selectedSheet]);
  const [selectedMonth, setSelectedMonth] = useState<string>("ALL");
  const [selectedStatus, setSelectedStatus] = useState<string>("ALL");
  const [selectedMotive, setSelectedMotive] = useState<string>("ALL");
  const [selectedExpiry, setSelectedExpiry] = useState<string>("ALL");
  const [selectedETF, setSelectedETF] = useState<string>("ALL");
  const [selectedIndustry, setSelectedIndustry] = useState<string>("ALL");
  const [selectedSubIndustry, setSelectedSubIndustry] = useState<string>("ALL");
  const [selectedSector, setSelectedSector] = useState<string>("ALL");

  useEffect(() => {
     setSelectedMonth("ALL");
     setSelectedStatus("ALL");
     setSelectedMotive("ALL");
     setSelectedExpiry("ALL");
     setSelectedETF("ALL");
     setSelectedIndustry("ALL");
     setSelectedSubIndustry("ALL");
     setSelectedSector("ALL");
  }, [selectedSheet, selectedIntersectSheets]);

  useEffect(() => {
     setSelectedSubIndustry("ALL");
     setSelectedSector("ALL");
  }, [selectedIndustry]);

  useEffect(() => {
     setSelectedSector("ALL");
  }, [selectedSubIndustry]);

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

  const SHEET_DESCRIPTIONS: Record<string, string> = {
    '上市價量齊揚': '股價六天新高，成交量大於前一天30%',
    '上櫃價量齊揚': '股價六天新高，成交量大於前一天30%',
    '上市_值得注意': '股價六天新高，營收六個月新高',
    '上櫃_值得注意': '股價六天新高，營收六個月新高',
    '投信連買篩選': '投信至少連續買超三天，股本5~50億的股票',
    '主動型ETF每日差異': '全體曝險排行Top50'
  };
  const [needsGasUpdate, setNeedsGasUpdate] = useState(false);

  // Drag and Drop state
  const [draggedSheetIndex, setDraggedSheetIndex] = useState<number | null>(null);
  const [dragOverSheetIndex, setDragOverSheetIndex] = useState<number | null>(null);

  // You can still manually test another URL in code, but UI hides it.
  const apiUrl = DEFAULT_API_URL;

  const handleDragStart = (e: React.DragEvent<HTMLLIElement>, index: number) => {
    setDraggedSheetIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnter = (e: React.DragEvent<HTMLLIElement>, index: number) => {
    if (draggedSheetIndex === null || draggedSheetIndex === index) return;
    setDragOverSheetIndex(index);
  };

  const handleDragEnd = () => {
     if (draggedSheetIndex !== null && dragOverSheetIndex !== null && draggedSheetIndex !== dragOverSheetIndex) {
         setSheets(prev => {
             const draggedSheetName = visibleSheets[draggedSheetIndex];
             const dragOverSheetName = visibleSheets[dragOverSheetIndex];
             
             if (draggedSheetName && dragOverSheetName) {
                 const actualDragIdx = prev.indexOf(draggedSheetName);
                 const actualDropIdx = prev.indexOf(dragOverSheetName);
                 
                 if (actualDragIdx !== -1 && actualDropIdx !== -1) {
                     const newSheets = [...prev];
                     newSheets.splice(actualDragIdx, 1);
                     newSheets.splice(actualDropIdx, 0, draggedSheetName);
                     localStorage.setItem('sheetOrder', JSON.stringify(newSheets));
                     return newSheets;
                 }
             }
             return prev;
         });
     }
     setDraggedSheetIndex(null);
     setDragOverSheetIndex(null);
  };

  const handleDragOver = (e: React.DragEvent<HTMLLIElement>) => {
    e.preventDefault();
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLLIElement>, index: number) => {
    setDraggedSheetIndex(index);
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLLIElement>) => {
    if (draggedSheetIndex === null) return;
    const touch = e.touches[0];
    const element = document.elementFromPoint(touch.clientX, touch.clientY);
    const li = element?.closest('li[data-index]');
    if (li) {
      const idx = parseInt(li.getAttribute('data-index') || '-1', 10);
      if (idx !== -1 && idx !== draggedSheetIndex) {
        setDragOverSheetIndex(idx);
      }
    }
  };

  const handleTouchEnd = () => {
     handleDragEnd();
  };

  const normalizeDataArray = (arr: any[]) => {
     if (!Array.isArray(arr)) return arr;
     const NORMALIZE_MAP: Record<string, string> = {
       "光電": "光電業",
       "半導體": "半導體業",
       "鋼鐵": "鋼鐵工業",
       "電子零組件": "電子零組件業",
       "電腦及周邊設備": "電腦及周邊設備業",
     };
     return arr.map(row => {
        const newRow: any = {};
        for (const key in row) {
            let newKey = key.trim();
            if (key === '備份日期' || key.trim() === '備份日期') {
                newKey = '日期';
            }
            const val = row[key];
            
            if (newKey === '主產業' || newKey.includes('主產業')) {
                if (typeof val === 'string') {
                    const trimmed = val.trim();
                    newRow[newKey] = NORMALIZE_MAP[trimmed] || val;
                } else {
                    newRow[newKey] = val;
                }
            } else {
                newRow[newKey] = val;
            }
        }
        return newRow;
     });
  };

  const fetchSheets = async () => {
    setLoadingSheets(true);
    setLoading(true);
    setNeedsGasUpdate(false);
    try {
      const response = await fetch(`${apiUrl}?action=getSheets`);
      
      if (!response.ok) throw new Error(`API 請求失敗: ${response.statusText}`);
      const jsonData = await response.json();
      
      if (jsonData && jsonData.sheets) {
        const sheetNames = jsonData.sheets as string[];
        
        const ordered = getOrderedSheets(sheetNames);
        setSheets(ordered);
        
        const targetSheet = selectedSheet && ordered.includes(selectedSheet) ? selectedSheet : (ordered[0] || "");
        if (!selectedSheet && targetSheet) {
          setSelectedSheet(targetSheet);
        }

        if (sheetNames.length > 0) {
           const initialSheets = [targetSheet];
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
                 initialDataMap[result.name] = normalizeDataArray(result.data);
              } else if (result.data && result.data.allData) {
                 // in case the backend somehow returned allData
                 const normData: Record<string, any[]> = {};
                 Object.keys(result.data.allData).forEach(k => {
                    normData[k] = normalizeDataArray(result.data.allData[k]);
                 });
                 Object.assign(initialDataMap, normData);
              } else {
                 initialDataMap[result.name] = [];
              }
           }
           setAllSheetsData(prev => ({ ...prev, ...initialDataMap }));
           
           // Loading is done for the initial view!
           setLoadingSheets(false);
           setLoading(false);
           setLastFetchTime(new Date());

           // Fetch remaining in the background sequentially or concurrently
           remainingSheets.forEach((name) => {
              fetch(`${apiUrl}?sheetName=${encodeURIComponent(name)}`)
                 .then(res => res.json())
                 .then(data => {
                    if (Array.isArray(data)) {
                       setAllSheetsData(prev => ({ ...prev, [name]: normalizeDataArray(data) }));
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
        const normalizedAllData: Record<string, any[]> = {};
        Object.keys(jsonData.allData).forEach(k => {
            normalizedAllData[k] = normalizeDataArray(jsonData.allData[k]);
        });
        setAllSheetsData(normalizedAllData);
        const ordered = getOrderedSheets(jsonData.sheets || []);
        setSheets(ordered);
        if (ordered.length > 0 && !selectedSheet) {
          setSelectedSheet(ordered[0]);
        }
        setLoadingSheets(false);
        setLoading(false);
        setLastFetchTime(new Date());
      } else if (Array.isArray(jsonData)) {
        // If it returned an array directly, the GAS script doesn't support getSheets yet
        setNeedsGasUpdate(true);
        setSheets(["預設工作表"]);
        if (!selectedSheet) setSelectedSheet("預設工作表");
        
        // Load default data right away to be nice
        const normalizedData = normalizeDataArray(jsonData);
        setAllSheetsData({ "預設工作表": normalizedData });
        setData(normalizedData);
        if (normalizedData.length > 0) {
            setColumns(Object.keys(normalizedData[0]));
        }
        setLoadingSheets(false);
        setLoading(false);
        setLastFetchTime(new Date());
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
         const normalizedAllData: Record<string, any[]> = {};
         Object.keys(jsonData.allData).forEach(k => {
             normalizedAllData[k] = normalizeDataArray(jsonData.allData[k]);
         });
         setAllSheetsData(normalizedAllData);
         if (jsonData.sheets) setSheets(getOrderedSheets(jsonData.sheets));
         sheetData = normalizedAllData[sheetName] || [];
      } else if (Array.isArray(jsonData)) {
         sheetData = normalizeDataArray(jsonData);
      }
      
      if (sheetData.length > 0) {
        setData(sheetData);
        setColumns(Object.keys(sheetData[0] as object));
        setAllSheetsData(prev => ({ ...prev, [sheetName]: sheetData }));
        setLastFetchTime(new Date());
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
       const favData: any[] = [];
       const uniqueSymbols = Array.from(favorites);
       
       let allKeys = new Set<string>();
       allKeys.add('代號');
       allKeys.add('名稱');
       
       const redundantKeys = ['代碼', '證券代號', '公司代號', '現股代號', 'ETF代號', '基金代號', 'ETF代碼', '公司名稱', '股票名稱', '股名', '簡稱', '證券名稱', 'ETF名稱', '名稱', '代號', '基金名稱'];

       uniqueSymbols.forEach(symbol => {
          const rowsForSymbol = allRows.filter(r => getSymbol(r) === symbol);
          
          let mergedRow: any = { '代號': symbol };
          
          if (rowsForSymbol.length > 0) {
              const name = rowsForSymbol.map(r => getName(r)).find(n => n) || '';
              mergedRow['名稱'] = name;
              
              rowsForSymbol.forEach(r => {
                  Object.keys(r).forEach(k => {
                      if (!redundantKeys.includes(k) && r[k] !== undefined && r[k] !== null && r[k] !== '') {
                          mergedRow[k] = r[k];
                      }
                  });
              });
          } else {
              mergedRow['名稱'] = '';
          }
          
          favData.push(mergedRow);
          Object.keys(mergedRow).forEach(k => {
              if (!redundantKeys.includes(k)) {
                  allKeys.add(k);
              }
          });
       });
       
       setData(favData);
       setColumns(Array.from(allKeys));
       return;
    }
    if (selectedSheet && selectedSheet !== 'MULTI_FILTER' && selectedSheet !== 'INSTITUTIONAL_RANKING' && !needsGasUpdate) {
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
           if (selectedMonth !== "ALL" && ['庫藏股', '財報_財務報告', '轉換公司債', '達公布注意交易資訊標準', '法說會_法人說明會'].includes(sheetName)) {
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
           if (selectedMotive !== "ALL" && sheetName === 'CB可轉債雷達') {
               const sheetCols = Object.keys(sData[0] || {});
               const targetCol = sheetCols.find(c => c === '主力誘因' || c.includes('主力誘因'));
               if (targetCol) {
                   sData = sData.filter(row => {
                      const val = String(row[targetCol!] || '').trim();
                      return val === selectedMotive || val.includes(selectedMotive);
                   });
               }
           }
           if (selectedETF !== "ALL" && sheetName.includes('主動型ETF')) {
               const sheetCols = Object.keys(sData[0] || {});
               const targetCol = sheetCols.find(c => c === 'ETF名稱' || c === 'ETF名稱(代號)' || c.includes('ETF名稱') || c.includes('基金名稱') || c.includes('ETF') || c.includes('基金'));
               if (targetCol) {
                   sData = sData.filter(row => {
                      const val = String(row[targetCol!] || '').trim();
                      return val === selectedETF || val.includes(selectedETF);
                   });
               }
           }
           if (selectedExpiry !== "ALL" && (sheetName === 'CB可轉債雷達' || sheetName === '轉換公司債')) {
               const sheetCols = Object.keys(sData[0] || {});
               const targetCol = sheetCols.find(c => c === '轉換迄日' || c.includes('迄日'));
               if (targetCol) {
                   const now = new Date();
                   now.setHours(0, 0, 0, 0); // normalize time
                   sData = sData.filter(row => {
                      const val = String(row[targetCol!] || '').trim();
                      if (!val) return false;
                      const expiryDate = new Date(val);
                      if (isNaN(expiryDate.getTime())) return true; // fallback
                      const diffTime = expiryDate.getTime() - now.getTime();
                      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                      
                      if (selectedExpiry === '近半年到期') return diffDays >= 0 && diffDays <= 183;
                      if (selectedExpiry === '近一年到期') return diffDays >= 0 && diffDays <= 365;
                      if (selectedExpiry === '1年~2年') return diffDays > 365 && diffDays <= 730;
                      if (selectedExpiry === '2年以上') return diffDays > 730;
                      if (selectedExpiry === '已到期') return diffDays < 0;
                      return true;
                   });
               }
           }
           return sData;
       };

       const dateSheetName = selectedIntersectSheets.find(s => ['庫藏股', '財報_財務報告', '轉換公司債', '達公布注意交易資訊標準', '法說會_法人說明會'].includes(s));
       
       const baseSheet = dateSheetName || selectedIntersectSheets[0];
       const baseData = getFilteredSheetData(baseSheet);
       const otherSheets = selectedIntersectSheets.filter(s => s !== baseSheet);
       const otherSheetsData = otherSheets.map(sheet => getFilteredSheetData(sheet));
       
       const otherSheetsMaps = otherSheetsData.map(sData => {
           const map = new Map<string, any>();
           sData.forEach(row => {
               const id = getSymbol(row);
               if (id) map.set(id, row);
           });
           return map;
       });

       const normalizeKey = (k: string) => {
           if (['代碼', '代號', '現股代號', '公司代號'].includes(k)) return '證券代號';
           if (['名稱', '股票名稱', '證券名稱'].includes(k)) return '公司名稱';
           return k;
       };

       const intersected = baseData.filter(row => {
          const id = getSymbol(row);
          if (!id) return false;
          return otherSheetsMaps.every(map => map.has(id));
       }).map(row => {
          const id = getSymbol(row);
          let mergedRawRow = { ...row };
          otherSheetsMaps.forEach(map => {
              const matchingRow = map.get(id!);
              if (matchingRow) {
                  mergedRawRow = { ...mergedRawRow, ...matchingRow };
              }
          });
          
          let normalizedRow: any = {};
          Object.keys(mergedRawRow).forEach(k => {
              const standardKey = normalizeKey(k);
              if (!normalizedRow[standardKey] || (mergedRawRow[k] && !normalizedRow[standardKey])) {
                 normalizedRow[standardKey] = mergedRawRow[k];
              }
          });
          return normalizedRow;
       });
       
       let mergedColumns: string[] = [];
       if (intersected.length > 0) {
           const colSet = new Set<string>();
           const addCols = (rowObj: any) => {
               if(rowObj) {
                   Object.keys(rowObj).forEach(k => {
                       const standardKey = normalizeKey(k);
                       if(!colSet.has(standardKey)) {
                           colSet.add(standardKey);
                           mergedColumns.push(standardKey);
                       }
                   });
               }
           };

           addCols(baseData.length > 0 ? baseData[0] : null);
           otherSheetsData.forEach(sData => {
               addCols(sData.length > 0 ? sData[0] : null);
           });
           
           const reorderedColumns: string[] = [];
           if (colSet.has('證券代號')) reorderedColumns.push('證券代號');
           if (colSet.has('公司名稱')) reorderedColumns.push('公司名稱');
           
           mergedColumns.forEach(k => {
               if (k !== '證券代號' && k !== '公司名稱') {
                   reorderedColumns.push(k);
               }
           });
           mergedColumns = reorderedColumns;
       }

       setData(intersected);
       setColumns(mergedColumns);
    }
  }, [selectedSheet, selectedIntersectSheets, allSheetsData, selectedMonth, selectedStatus, selectedMotive, selectedETF, selectedExpiry]);

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
                       setAllSheetsData(all => ({ ...all, [sheet]: normalizeDataArray(fetchedData) }));
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

  const availableDashboardDates = useMemo(() => {
     if (selectedSheet !== '台股盤後資料AI分析' && selectedSheet !== '美股早報') return [];
     const sheetData = allSheetsData[selectedSheet] || [];
     if (sheetData.length === 0) return [];
     
     const dates = new Set<string>();
     sheetData.forEach(row => {
         const name = row['名稱'] || row['公司名稱'] || row['股票名稱'] || row['證券名稱'] || '';
         if (selectedSheet === '美股早報' && (name === '比特幣' || name === '以太幣')) {
             return;
         }

         let dateText = row['備份日期'] || row['日期'] || '';
         if (dateText && typeof dateText === 'string' && dateText.includes(' ')) {
             dateText = dateText.split(' ')[0];
         }
         if (dateText) {
             dates.add(dateText);
         }
     });
     return Array.from(dates).sort((a, b) => b.localeCompare(a));
  }, [selectedSheet, allSheetsData]);

  const hasDateSheet = selectedSheet === 'MULTI_FILTER' 
    ? selectedIntersectSheets.some(s => ['庫藏股', '財報_財務報告', '轉換公司債', '達公布注意交易資訊標準', '法說會_法人說明會'].includes(s))
    : ['庫藏股', '財報_財務報告', '轉換公司債', '達公布注意交易資訊標準', '法說會_法人說明會'].includes(selectedSheet || '');

  const availableMonths = useMemo(() => {
    if (!hasDateSheet) return [];
    
    // Find which sheet is the date sheet
    let dateSheetName = selectedSheet === 'MULTI_FILTER' 
       ? selectedIntersectSheets.find(s => ['庫藏股', '財報_財務報告', '轉換公司債', '達公布注意交易資訊標準', '法說會_法人說明會'].includes(s))
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

  const availableIndustries = useMemo(() => {
     const col = columns.find(c => c === '主產業' || c.includes('主產業'));
     if (!col) return [];
     const set = new Set<string>();
     data.forEach(row => {
        const val = String(row[col] || '').trim();
        if (val && val !== '-') set.add(val);
     });
     return Array.from(set).sort();
  }, [data, columns]);
  
  const availableSubIndustries = useMemo(() => {
     const col = columns.find(c => c === '細產業' || c.includes('細產業'));
     const indCol = columns.find(c => c === '主產業' || c.includes('主產業'));
     if (!col) return [];
     const set = new Set<string>();
     data.forEach(row => {
        if (selectedIndustry !== "ALL" && indCol) {
           if (String(row[indCol] || '').trim() !== selectedIndustry) return;
        }
        const val = String(row[col] || '').trim();
        if (val && val !== '-') set.add(val);
     });
     return Array.from(set).sort();
  }, [data, columns, selectedIndustry]);

  const availableSectors = useMemo(() => {
     const col = columns.find(c => c === '子領域' || c.includes('子領域'));
     const indCol = columns.find(c => c === '主產業' || c.includes('主產業'));
     const subIndCol = columns.find(c => c === '細產業' || c.includes('細產業'));
     if (!col) return [];
     const set = new Set<string>();
     data.forEach(row => {
        if (selectedIndustry !== "ALL" && indCol) {
           if (String(row[indCol] || '').trim() !== selectedIndustry) return;
        }
        if (selectedSubIndustry !== "ALL" && subIndCol) {
           if (String(row[subIndCol] || '').trim() !== selectedSubIndustry) return;
        }
        const val = String(row[col] || '').trim();
        if (val && val !== '-') set.add(val);
     });
     return Array.from(set).sort();
  }, [data, columns, selectedIndustry, selectedSubIndustry]);

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

  const hasMotiveSheet = selectedSheet === 'MULTI_FILTER'
    ? selectedIntersectSheets.some(s => s === 'CB可轉債雷達')
    : selectedSheet === 'CB可轉債雷達';

  const availableMotives = useMemo(() => {
     if (!hasMotiveSheet) return [];
     let motiveSheetName = selectedSheet === 'MULTI_FILTER'
       ? selectedIntersectSheets.find(s => s === 'CB可轉債雷達')
       : selectedSheet;
     if (!motiveSheetName) return [];
     const sheetData = allSheetsData[motiveSheetName] || [];
     if (sheetData.length === 0) return [];
     const sheetCols = Object.keys(sheetData[0] || {});
     let targetCol = sheetCols.find(c => c === '主力誘因' || c.includes('主力誘因'));
     if (!targetCol) return [];
     const motives = new Set<string>();
     sheetData.forEach(row => {
         const val = row[targetCol!];
         if (val !== undefined && val !== null && val !== '') {
             motives.add(String(val).trim());
         }
     });
     return Array.from(motives).sort();
  }, [selectedSheet, selectedIntersectSheets, allSheetsData, hasMotiveSheet]);

  const hasETFSheet = selectedSheet === 'MULTI_FILTER'
    ? selectedIntersectSheets.some(s => s.includes('主動型ETF'))
    : selectedSheet?.includes('主動型ETF');

  const availableETFs = useMemo(() => {
     if (!hasETFSheet) return [];
     let etfSheetName = selectedSheet === 'MULTI_FILTER'
       ? selectedIntersectSheets.find(s => s.includes('主動型ETF'))
       : selectedSheet;
     if (!etfSheetName) return [];
     const sheetData = allSheetsData[etfSheetName] || [];
     if (sheetData.length === 0) return [];
     const sheetCols = Object.keys(sheetData[0] || {});
     let targetCol = sheetCols.find(c => c === 'ETF名稱' || c === 'ETF名稱(代號)' || c.includes('ETF名稱') || c.includes('基金名稱') || c.includes('ETF') || c.includes('基金'));
     if (!targetCol) return [];
     const etfs = new Set<string>();
     sheetData.forEach(row => {
         const val = row[targetCol!];
         if (val !== undefined && val !== null && val !== '') {
             etfs.add(String(val).trim());
         }
     });
     return Array.from(etfs).sort();
  }, [selectedSheet, selectedIntersectSheets, allSheetsData, hasETFSheet]);

   const isCBRadar = selectedSheet === '轉換公司債' || selectedIntersectSheets.includes('轉換公司債') || selectedSheet === 'CB可轉債雷達' || selectedIntersectSheets.includes('CB可轉債雷達');
   const stickyColCount = isMobile ? 1 : (isCBRadar ? 3 : 2);
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
          boxSizing: 'border-box' as const,
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
    if (selectedSheet && selectedSheet !== 'MULTI_FILTER' && selectedSheet !== 'FAVORITES' && selectedSheet !== 'INSTITUTIONAL_RANKING') {
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

    if (selectedSheet !== 'MULTI_FILTER' && selectedMotive !== "ALL" && hasMotiveSheet) {
       let targetCol = columns.find(c => c === '主力誘因' || c.includes('主力誘因'));
       if (targetCol) {
          result = result.filter(row => {
             const val = String(row[targetCol!] || '').trim();
             return val === selectedMotive || val.includes(selectedMotive);
          });
       }
    }

    if (selectedSheet !== 'MULTI_FILTER' && selectedETF !== "ALL" && hasETFSheet) {
       let targetCol = columns.find(c => c === 'ETF名稱' || c === 'ETF名稱(代號)' || c.includes('ETF名稱') || c.includes('基金名稱') || c.includes('ETF') || c.includes('基金'));
       if (targetCol) {
          result = result.filter(row => {
             const val = String(row[targetCol!] || '').trim();
             return val === selectedETF || val.includes(selectedETF);
          });
       }
    }

    if (selectedSheet !== 'MULTI_FILTER' && selectedExpiry !== "ALL" && isCBRadar) {
       let targetCol = columns.find(c => c === '轉換迄日' || c.includes('迄日'));
       if (targetCol) {
          const now = new Date();
          now.setHours(0, 0, 0, 0);
          result = result.filter(row => {
             const val = String(row[targetCol!] || '').trim();
             if (!val) return false;
             const expiryDate = new Date(val);
             if (isNaN(expiryDate.getTime())) return true;
             const diffTime = expiryDate.getTime() - now.getTime();
             const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
             
             if (selectedExpiry === '近半年到期') return diffDays >= 0 && diffDays <= 183;
             if (selectedExpiry === '近一年到期') return diffDays >= 0 && diffDays <= 365;
             if (selectedExpiry === '1年~2年') return diffDays > 365 && diffDays <= 730;
             if (selectedExpiry === '2年以上') return diffDays > 730;
             if (selectedExpiry === '已到期') return diffDays < 0;
             return true;
          });
       }
    }

    let indCol = columns.find(c => c === '主產業' || c.includes('主產業'));
    if (indCol && selectedIndustry !== "ALL") {
       result = result.filter(row => String(row[indCol] || '').trim() === selectedIndustry);
    }

    let subIndCol = columns.find(c => c === '細產業' || c.includes('細產業'));
    if (subIndCol && selectedSubIndustry !== "ALL") {
       result = result.filter(row => String(row[subIndCol] || '').trim() === selectedSubIndustry);
    }

    let sectorCol = columns.find(c => c === '子領域' || c.includes('子領域'));
    if (sectorCol && selectedSector !== "ALL") {
       result = result.filter(row => String(row[sectorCol] || '').trim() === selectedSector);
    }

    if (!searchTerm) return result;
    const lowerSearch = searchTerm.toLowerCase();
    return result.filter(row => 
      columns.some(col => {
         const val = row[col];
         return val !== null && val !== undefined && String(val).toLowerCase().includes(lowerSearch);
      })
    );
  }, [data, columns, searchTerm, selectedMonth, selectedStatus, selectedMotive, selectedExpiry, selectedETF, selectedIndustry, selectedSubIndustry, selectedSector, hasDateSheet, hasStatusSheet, hasMotiveSheet, hasETFSheet, isCBRadar, selectedSheet]);

  const [sortConfigs, setSortConfigs] = useState<{ key: string; direction: 'asc' | 'desc' }[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [showColumnSelector, setShowColumnSelector] = useState(false);
  const pageSize = 100;

  useEffect(() => {
     setCurrentPage(1);
  }, [selectedSheet, selectedIntersectSheets, selectedMonth, selectedStatus, selectedMotive, selectedExpiry, selectedETF, selectedIndustry, selectedSubIndustry, selectedSector, searchTerm, sortConfigs]);

  useEffect(() => {
     setSortConfigs([]);
  }, [selectedSheet, selectedIntersectSheets]);

  useEffect(() => {
     const initialHidden = new Set<string>();
     if (selectedSheet?.includes('三大法人買賣超')) {
         columns.forEach(col => {
             if (col.includes('買進') || col.includes('賣出') || col.includes('自營買賣超總計')) {
                 initialHidden.add(col);
             }
         });
     }
     setHiddenColumns(initialHidden);
  }, [selectedSheet, selectedIntersectSheets, columns]);

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
     setSortConfigs(prev => {
        // Multi-column sort
        const existingIdx = prev.findIndex(c => c.key === key);
        if (existingIdx !== -1) {
           const existing = prev[existingIdx];
           const newConfigs = [...prev];
           if (existing.direction === 'asc') {
              newConfigs[existingIdx] = { key, direction: 'desc' };
           } else {
              newConfigs.splice(existingIdx, 1);
           }
           return newConfigs;
        } else {
           // Add to the end (limit to 3 levels deep)
           const newConfigs = [...prev, { key, direction: 'asc' }];
           if (newConfigs.length > 3) newConfigs.shift();
           return newConfigs;
        }
     });
  };

  const sortedData = useMemo(() => {
    let sortableItems = [...filteredData];
    if (sortConfigs.length > 0) {
      sortableItems.sort((a, b) => {
        for (const config of sortConfigs) {
           let aValue = a[config.key];
           let bValue = b[config.key];
           
           if (typeof aValue === 'string') aValue = aValue.trim();
           if (typeof bValue === 'string') bValue = bValue.trim();
           
           if (aValue === bValue) continue;

           const aEmpty = aValue === null || aValue === undefined || aValue === '';
           const bEmpty = bValue === null || bValue === undefined || bValue === '';

           if (aEmpty) return config.direction === 'asc' ? 1 : -1;
           if (bEmpty) return config.direction === 'asc' ? -1 : 1;
           
           if (config.key.includes('本益比狀態')) {
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
                  return config.direction === 'asc' ? aOrder - bOrder : bOrder - aOrder;
              }
              continue;
           }

           if (config.key.includes('乖離率狀態')) {
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
                  return config.direction === 'asc' ? aOrder - bOrder : bOrder - aOrder;
              }
              continue;
           }

           const aNum = Number(aValue);
           const bNum = Number(bValue);
           const isNumeric = !isNaN(aNum) && !isNaN(bNum);

           if (isNumeric) {
              if (aNum !== bNum) {
                 return config.direction === 'asc' ? aNum - bNum : bNum - aNum;
              }
              continue;
           }

           if (typeof aValue === 'string' && typeof bValue === 'string' && aValue.includes('%') && bValue.includes('%')) {
              const aPct = parseFloat(aValue.replace(/%/g, ''));
              const bPct = parseFloat(bValue.replace(/%/g, ''));
              if (!isNaN(aPct) && !isNaN(bPct)) {
                 if (aPct !== bPct) {
                    return config.direction === 'asc' ? aPct - bPct : bPct - aPct;
                 }
                 continue;
              }
           }

           aValue = String(aValue).toLowerCase();
           bValue = String(bValue).toLowerCase();
           
           if (aValue < bValue) {
             return config.direction === 'asc' ? -1 : 1;
           }
           if (aValue > bValue) {
             return config.direction === 'asc' ? 1 : -1;
           }
        }
        return 0;
      });
    }
    return sortableItems;
  }, [filteredData, sortConfigs]);

  const [filterPresets, setFilterPresets] = useState<{ id: string, name: string, sheets: string[], month: string, status: string, motive?: string, industry: string, subIndustry: string, sector: string }[]>(() => {
     try {
        const saved = localStorage.getItem('filterPresets');
        return saved ? JSON.parse(saved) : [];
     } catch {
        return [];
     }
  });

  useEffect(() => {
     localStorage.setItem('filterPresets', JSON.stringify(filterPresets));
  }, [filterPresets]);

  const [showPresetModal, setShowPresetModal] = useState(false);
  const [presetNameInput, setPresetNameInput] = useState('新篩選組合');

  const handleSavePresetClick = () => {
      setPresetNameInput('新篩選組合');
      setShowPresetModal(true);
  };

  const confirmSavePreset = () => {
      if (!presetNameInput.trim()) return;
      
      const newPreset = {
          id: Date.now().toString(),
          name: presetNameInput.trim(),
          sheets: selectedIntersectSheets,
          month: selectedMonth,
          status: selectedStatus,
          motive: selectedMotive,
          industry: selectedIndustry,
          subIndustry: selectedSubIndustry,
          sector: selectedSector
      };
      setFilterPresets(prev => [...prev, newPreset]);
      setShowPresetModal(false);
  };

  const applyPreset = (preset: typeof filterPresets[0]) => {
      setSelectedIntersectSheets(preset.sheets);
      setSelectedMonth(preset.month);
      setSelectedStatus(preset.status);
      if (preset.motive) setSelectedMotive(preset.motive);
      else setSelectedMotive("ALL");
      setSelectedIndustry(preset.industry);
      setSelectedSubIndustry(preset.subIndustry);
      setSelectedSector(preset.sector);
  };

  const removePreset = (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      setFilterPresets(prev => prev.filter(p => p.id !== id));
  };

  const exportToCSV = () => {
     if (!sortedData || sortedData.length === 0) return;
     const exportData = sortedData.map(row => {
         const newRow: Record<string, any> = {};
         visibleColumns.forEach(c => {
             newRow[c] = row[c];
         });
         return newRow;
     });
     
     const csv = Papa.unparse(exportData);
     const blob = new Blob(["\ufeff" + csv], { type: 'text/csv;charset=utf-8;' });
     const link = document.createElement("a");
     const url = URL.createObjectURL(blob);
     link.setAttribute("href", url);
     link.setAttribute("download", `${selectedSheet === 'MULTI_FILTER' ? '自訂篩選' : selectedSheet}_${new Date().toISOString().slice(0,10)}.csv`);
     link.style.visibility = 'hidden';
     document.body.appendChild(link);
     link.click();
     document.body.removeChild(link);
  };

  const renderDashboardView = () => {
      const isUS = selectedSheet === '美股早報';
      
      const targetDate = selectedDashboardDate === 'NEWEST' ? availableDashboardDates[0] : selectedDashboardDate;
      
      let dashboardData = data;
      let dashboardSortedData = sortedData;
      
      if (targetDate) {
          const targetPlusOne = new Date(targetDate);
          targetPlusOne.setDate(targetPlusOne.getDate() + 1);
          const targetPlusOneStr = targetPlusOne.toISOString().split('T')[0];

          const filteredData = data.filter(row => {
              let rowDate = row['備份日期'] || row['日期'] || '';
              if (rowDate && typeof rowDate === 'string' && rowDate.includes(' ')) {
                  rowDate = rowDate.split(' ')[0];
              }
              const name = row['名稱'] || row['公司名稱'] || row['股票名稱'] || row['證券名稱'] || '';
              if (selectedSheet === '美股早報' && (name === '比特幣' || name === '以太幣')) {
                  return rowDate === targetDate || rowDate === targetPlusOneStr;
              }
              return rowDate === targetDate;
          });

          const filteredSortedData = sortedData.filter(row => {
              let rowDate = row['備份日期'] || row['日期'] || '';
              if (rowDate && typeof rowDate === 'string' && rowDate.includes(' ')) {
                  rowDate = rowDate.split(' ')[0];
              }
              const name = row['名稱'] || row['公司名稱'] || row['股票名稱'] || row['證券名稱'] || '';
              if (selectedSheet === '美股早報' && (name === '比特幣' || name === '以太幣')) {
                  return rowDate === targetDate || rowDate === targetPlusOneStr;
              }
              return rowDate === targetDate;
          });

          // Deduplicate crypto, keeping the latest date
          const deduplicateCrypto = (arr: any[]) => {
              const cryptoMap = new Map();
              const result = [];
              for (const row of arr) {
                  const name = row['名稱'] || row['公司名稱'] || row['股票名稱'] || row['證券名稱'] || '';
                  if (selectedSheet === '美股早報' && (name === '比特幣' || name === '以太幣')) {
                      let rowDate = row['備份日期'] || row['日期'] || '';
                      if (rowDate && typeof rowDate === 'string' && rowDate.includes(' ')) {
                          rowDate = rowDate.split(' ')[0];
                      }
                      const existing = cryptoMap.get(name);
                      if (!existing || rowDate > existing.date) {
                          cryptoMap.set(name, { date: rowDate, row });
                      }
                  } else {
                      result.push(row);
                  }
              }
              for (const item of cryptoMap.values()) {
                  result.push(item.row);
              }
              return result;
          };

          dashboardData = deduplicateCrypto(filteredData);
          dashboardSortedData = deduplicateCrypto(filteredSortedData);
      }
      
      const aiReportColumn = columns.find(c => c.includes('AI') && (c.includes('總結') || c.includes('報告') || c.includes('結論')));
      let aiReportText = dashboardData[0]?.[aiReportColumn as string] || '';
      let dateText = dashboardData[0]?.['備份日期'] || dashboardData[0]?.['日期'] || '';
      
      if (dateText && typeof dateText === 'string' && dateText.includes(' ')) {
          dateText = dateText.split(' ')[0];
      }

      const title = isUS ? 'AI 晨間總結' : 'AI 盤後總結';
      const Icon = isUS ? Sun : Moon;
      const subtitle = isUS ? '每天早上6:30更新' : '每天晚上22:30更新';

      let sections: {title: string, sheets: string[], stocks: any[]}[] = [];

      if (isUS) {
          let cardsData = dashboardSortedData.filter(row => row['目前股價'] || row['收盤價'] || row['成交價'] || row['最新股價'] || row['股價'] || row['今日漲跌幅(%)'] || row['今日漲跌幅'] || row['漲跌幅(%)'] || row['漲跌幅'] || row['日漲跌幅(%)'] || row['日漲跌幅'] || row['最新漲跌幅'] || row['最新漲跌幅(%)']);
          
          const getCategoryOrder = (name) => {
              if (!name) return 99;
              if (/(道瓊|S&P 500|標普|那斯達克|費城半導體|費半|羅素|VIX|殖利率|指數)/i.test(name)) return 1;
              if (/期貨/i.test(name)) return 2;
              if (/(ETF|類股)/i.test(name)) return 3;
              if (/(比特幣|以太幣|加密貨幣|虛擬貨幣|BTC|ETH)/i.test(name)) return 5;
              return 4;
          };

          cardsData = [...cardsData].sort((a, b) => {
              const nameA = a['名稱'] || String(a['代碼'] || a['代號'] || '') || '';
              const nameB = b['名稱'] || String(b['代碼'] || b['代號'] || '') || '';
              const orderA = getCategoryOrder(nameA);
              const orderB = getCategoryOrder(nameB);
              return orderA - orderB;
          });

          if (cardsData.length > 0) {
              sections.push({ title: '美股行情', sheets: [], stocks: cardsData });
          }
      } else {
          const isNewFormat = columns.includes('潛力股點評') || columns.includes('說明');
          
          if (isNewFormat) {
              const allStocksMap = new Map();
              Object.entries(allSheetsData).forEach(([sheetName, sheetData]) => {
                  if (sheetName === selectedSheet) return;
                  sheetData.forEach(row => {
                      const symbol = getSymbol(row);
                      if (symbol) {
                          const hasPriceData = row['目前股價'] || row['收盤價'] || row['成交價'] || row['最新股價'] || row['股價'] || row['今日漲跌幅(%)'] || row['今日漲跌幅'] || row['漲跌幅(%)'] || row['漲跌幅'] || row['日漲跌幅(%)'] || row['日漲跌幅'] || row['最新漲跌幅'] || row['最新漲跌幅(%)'];
                          if (!allStocksMap.has(symbol)) {
                              allStocksMap.set(symbol, { ...row });
                          } else {
                              const existing = allStocksMap.get(symbol);
                              const newEntry = { ...existing };
                              // Only overwrite with non-empty values
                              for (const key in row) {
                                  if (row[key] !== '' && row[key] !== null && row[key] !== undefined) {
                                      newEntry[key] = row[key];
                                  }
                              }
                              allStocksMap.set(symbol, newEntry);
                          }
                      }
                  });
              });

              const getStockRow = (symbol: string, name: string, preferredSheets: string[]) => {
                  for (const sheetName of preferredSheets) {
                      let targetSheet = allSheetsData[sheetName];
                      if (!targetSheet) {
                          targetSheet = allSheetsData[sheetName.replace(/工作表$/, '')];
                      }
                      if (targetSheet) {
                          const found = targetSheet.find(r => getSymbol(r) === symbol);
                          if (found) return { ...found, '代碼': symbol, '名稱': name };
                      }
                  }
                  if (allStocksMap.has(symbol)) {
                      return { ...allStocksMap.get(symbol), '代碼': symbol, '名稱': name };
                  }
                  return null;
              };
              
              let newFormatText = '';

              dashboardSortedData.forEach(row => {
                  const category = row['潛力股點評'];
                  const symbol = getSymbol(row);
                  const name = getName(row);
                  const desc = row['說明'];
                  const sourceStr = row['來源檔案名稱'] || '';
                  const sourceSheets = sourceStr ? sourceStr.split(/[,、]/).map((s: string) => s.trim()) : [];

                  if (category === '資金流向' || category?.includes('資金流向')) {
                      if (desc) {
                          newFormatText += (newFormatText ? '\n\n' : '') + desc;
                      }
                  } else if (symbol && category) {
                      let section = sections.find(s => s.title === category);
                      if (!section) {
                          section = { title: category, sheets: [], stocks: [] };
                          sections.push(section);
                      }
                      sourceSheets.forEach((s: string) => {
                          if (!section.sheets.includes(s)) section.sheets.push(s);
                      });
                      
                      const stockData = getStockRow(symbol, name || '未命名', sourceSheets);
                      let mergedDate = row['備份日期'] || row['日期'] || stockData?.['備份日期'] || stockData?.['日期'];
                      if (mergedDate && typeof mergedDate === 'string' && mergedDate.includes(' ')) {
                          mergedDate = mergedDate.split(' ')[0];
                      }
                      section.stocks.push({ ...row, ...stockData, '代碼': symbol, '名稱': name, '說明': desc, '日期': mergedDate });
                  }
              });
              
              if (newFormatText) {
                  aiReportText = newFormatText;
              }
          } else {
              // Parse the AI Report Text for old 台股盤後資料AI分析
              const lines = aiReportText.split('\n');
              let currentSection = {
                  title: '其他提及股票',
                  sheets: [] as string[],
                  stocks: [] as any[]
              };
              sections.push(currentSection);
              
              const sheetNameRegex = /【(.*?)】/g;
              const symbolRegex1 = /\b(\d{4,6})[\s\-\_]*([A-Za-z\u4e00-\u9fa5]+)/g;
              const symbolRegex2 = /([A-Za-z\u4e00-\u9fa5]+)[\s\-\_]*[（\(](\d{4,6})[）\)]/g;
              
              const allStocksMap = new Map();
              Object.entries(allSheetsData).forEach(([sheetName, sheetData]) => {
                  if (sheetName === selectedSheet) return;
                  sheetData.forEach(row => {
                      const symbol = getSymbol(row);
                      if (symbol) {
                          const hasPriceData = row['目前股價'] || row['收盤價'] || row['成交價'] || row['最新股價'] || row['股價'] || row['今日漲跌幅(%)'] || row['今日漲跌幅'] || row['漲跌幅(%)'] || row['漲跌幅'] || row['日漲跌幅(%)'] || row['日漲跌幅'] || row['最新漲跌幅'] || row['最新漲跌幅(%)'];
                          if (!allStocksMap.has(symbol)) {
                              allStocksMap.set(symbol, { ...row });
                          } else {
                              const existing = allStocksMap.get(symbol);
                              const newEntry = { ...existing };
                              // Only overwrite with non-empty values
                              for (const key in row) {
                                  if (row[key] !== '' && row[key] !== null && row[key] !== undefined) {
                                      newEntry[key] = row[key];
                                  }
                              }
                              allStocksMap.set(symbol, newEntry);
                          }
                      }
                  });
              });
  
              // Helper to find stock row data
              const getStockRow = (symbol: string, name: string, preferredSheets: string[]) => {
                  // 1. Check preferred sheets first
                  for (const sheetName of preferredSheets) {
                      const targetSheet = allSheetsData[sheetName];
                      if (targetSheet) {
                          const found = targetSheet.find(r => getSymbol(r) === symbol);
                          if (found) return { ...found, '代碼': symbol, '名稱': name };
                      }
                  }
                  // 2. Fallback to any sheet
                  if (allStocksMap.has(symbol)) {
                      return { ...allStocksMap.get(symbol), '代碼': symbol, '名稱': name };
                  }
                  // 3. Just mock
                  return { '代碼': symbol, '名稱': name };
              };
  
              const seenSymbols = new Set<string>();
  
              for (const line of lines) {
                  let match;
                  const sheetsInLine: string[] = [];
                  while ((match = sheetNameRegex.exec(line)) !== null) {
                      sheetsInLine.push(match[1].trim());
                  }
                  
                  if (sheetsInLine.length > 0) {
                      currentSection = {
                          title: line.replace(/：選自.*工作表/, '').trim(),
                          sheets: sheetsInLine,
                          stocks: []
                      };
                      sections.push(currentSection);
                  }
                  
                  const extractStocks = (regex: RegExp, symGroup: number, nameGroup: number) => {
                      let m;
                      while ((m = regex.exec(line)) !== null) {
                          const sym = m[symGroup];
                          const nm = m[nameGroup];
                          if (sym && nm && nm.length > 0) {
                              if (!seenSymbols.has(sym)) {
                                  seenSymbols.add(sym);
                                  currentSection.stocks.push(getStockRow(sym, nm, currentSection.sheets));
                              }
                          }
                      }
                  };
                  
                  extractStocks(symbolRegex1, 1, 2);
                  extractStocks(symbolRegex2, 2, 1);
              }
              
              allStocksMap.forEach((row, symbol) => {
                  if (seenSymbols.has(symbol)) return;
                  const name = getName(row);
                  const symbolRegex = new RegExp(`(^|[^\\d])${symbol}([^\\d]|$)`);
                  const hasSymbol = symbolRegex.test(aiReportText);
                  const hasName = name && name.length >= 2 ? aiReportText.includes(name) : false;
                  
                  if (hasSymbol || hasName) {
                      sections[0].stocks.push({ ...row, '代碼': symbol, '名稱': name || "" });
                      seenSymbols.add(symbol);
                  }
              });
          }
      }

      sections = sections.filter(s => s.stocks.length > 0);
      
      const renderCard = (row: any, idx: number) => {
          const symbol = getSymbol(row);
          const name = getName(row) || symbol || '未命名';
          const priceStr = row['目前股價'] || row['收盤價'] || row['成交價'] || row['最新股價'] || row['股價'];
          const changeStr = row['今日漲跌幅(%)'] || row['今日漲跌幅'] || row['漲跌幅(%)'] || row['漲跌幅'] || row['日漲跌幅(%)'] || row['日漲跌幅'] || row['最新漲跌幅'] || row['最新漲跌幅(%)'];
          const desc = row['說明'];
          
          let price = priceStr;
          if (priceStr !== null && priceStr !== undefined && !isNaN(Number(priceStr)) && priceStr !== '') {
              price = parseFloat(Number(priceStr).toFixed(2)).toString();
          }
          
          let changeNum = parseFloat(changeStr || '0');
          let change = changeStr;
          if (changeStr !== null && changeStr !== undefined && !isNaN(Number(changeStr)) && changeStr !== '') {
              change = parseFloat(Number(changeStr).toFixed(2)).toString();
          }
          
          const isPositive = changeNum > 0;
          const isNegative = changeNum < 0;
          
          return (
              <div key={`${symbol}-${idx}`} onClick={() => !isUS && setSelectedRowInfo(row)} className={`relative bg-white dark:bg-gray-900 p-4 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 flex flex-col items-center justify-center text-center transition-all animate-in zoom-in-95 duration-500 ${!isUS ? 'hover:shadow-md hover:border-indigo-200 dark:hover:border-indigo-800 cursor-pointer' : ''}`} style={{ animationDelay: `${Math.min(idx * 30, 500)}ms` }}>
                 {!isUS && symbol && (
                    <button 
                       onClick={(e) => toggleFavorite(e, row)}
                       className={`absolute top-2 right-2 p-1.5 rounded-full transition-colors z-10 ${
                          favorites.has(symbol)
                            ? 'text-pink-500 bg-pink-50 dark:bg-pink-900/40 hover:bg-pink-100'
                            : 'text-gray-300 hover:text-pink-400 hover:bg-pink-50 dark:hover:bg-gray-800'
                       }`}
                       title="加入自選"
                    >
                      <Heart className="w-4 h-4" fill={favorites.has(symbol) ? "currentColor" : "none"} />
                    </button>
                 )}
                  <div className="font-medium text-gray-500 dark:text-gray-400 mb-1.5 truncate w-full px-1 text-sm md:text-base mt-2" title={name}>{name}</div>
                  <div className="text-xl md:text-2xl font-bold text-gray-900 dark:text-gray-50 mb-2 truncate max-w-full px-1" title={price || '-'}>{price || '-'}</div>
                  <div className={`flex items-center justify-center gap-1 px-2.5 py-1 rounded-full font-bold text-xs md:text-sm ${isPositive ? 'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400' : isNegative ? 'bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'}`}>
                      {isPositive ? <TrendingUp className="w-3.5 h-3.5" /> : isNegative ? <TrendingDown className="w-3.5 h-3.5" /> : <span className="w-3.5 h-3.5 line-clamp-1 block leading-[14px] text-center">-</span>}
                      {(() => {
                          let changeDisplay = typeof change === 'string' && change.endsWith('%') ? change : change + '%';
                          return changeNum !== 0 ? (changeNum > 0 ? '+' + changeDisplay : changeDisplay) : (change ? changeDisplay : '-');
                      })()}
                  </div>
                  {desc && (
                     <div className="mt-3 text-xs text-gray-500 dark:text-gray-400 text-left w-full line-clamp-3">
                         {desc}
                     </div>
                  )}
              </div>
          );
      };

      return (
          <div className="flex flex-col gap-6 w-full p-2 md:p-6 pb-20 animate-in fade-in duration-500">
              {aiReportText && (
                  <div className="bg-white dark:bg-gray-900 rounded-xl p-5 md:p-6 shadow-sm border border-gray-200 dark:border-gray-700">
                      <div className="flex flex-col gap-1 mb-6 border-b border-gray-100 dark:border-gray-800 pb-4">
                          <div className="flex items-center gap-2">
                              <Icon className={`w-6 h-6 ${isUS ? 'text-orange-500' : 'text-indigo-400'}`} />
                              <h2 className="text-xl font-bold text-gray-900 dark:text-gray-50 tracking-tight">{title}</h2>
                              <div className="ml-auto flex items-center gap-2">
                                  {availableDashboardDates.length > 0 && (
                                      <select
                                          value={selectedDashboardDate}
                                          onChange={(e) => setSelectedDashboardDate(e.target.value)}
                                          className="block py-1 px-3 bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all shadow-inner"
                                      >
                                          <option value="NEWEST">最新</option>
                                          {availableDashboardDates.map(date => (
                                              <option key={date} value={date}>{date}</option>
                                          ))}
                                      </select>
                                  )}
                                  {dateText && <span className="hidden sm:inline-block text-sm font-medium text-gray-500 bg-gray-100 dark:bg-gray-800 px-3 py-1 rounded-full">{dateText}</span>}
                              </div>
                          </div>
                          <div className="text-sm font-medium text-gray-500 dark:text-gray-400 ml-8">
                              {subtitle}
                          </div>
                      </div>
                      <div className="prose prose-sm sm:prose-base dark:prose-invert max-w-none prose-indigo markdown-body leading-relaxed text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                          <Markdown>{aiReportText}</Markdown>
                      </div>
                  </div>
              )}
              
              {sections.map((section, sIdx) => (
                  <div key={sIdx} className="flex flex-col gap-3">
                      <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2 px-2 md:px-0">
                          <Bookmark className="w-5 h-5 text-indigo-500" />
                          {section.title}
                          {section.sheets.length > 0 && (
                              <span className="text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 px-2 py-1 rounded-full ml-auto">
                                  資料來源: {section.sheets.join(', ')}
                              </span>
                          )}
                      </h3>
                      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-4">
                          {section.stocks.map((row, idx) => renderCard(row, idx))}
                      </div>
                  </div>
              ))}
          </div>
      );
  };

  if (loadingSheets && Object.keys(allSheetsData).length === 0 && !error) {
    return (
      <div className="flex h-[100dvh] w-full bg-indigo-50/30 flex-col items-center justify-center font-sans animate-in fade-in duration-500">
        <div className="flex flex-col items-center animate-pulse">
          <div className="w-20 h-20 bg-indigo-100 dark:bg-indigo-900/60 rounded-3xl flex items-center justify-center mb-8 shadow-sm">
            <Table2 className="w-10 h-10 text-indigo-600 dark:text-indigo-400" />
          </div>
          <h2 className="text-3xl font-bold text-gray-900 dark:text-gray-50 mb-3 tracking-tight">股票資料庫</h2>
          <p className="text-gray-500 dark:text-gray-400 text-base mb-8 text-center max-w-sm">正在從 Google 試算表同步資料，請稍候...</p>
          <div className="flex gap-2.5 items-center text-indigo-600 dark:text-indigo-400 font-medium bg-indigo-50 dark:bg-indigo-900/40 px-5 py-2.5 rounded-full shadow-sm">
             <RefreshCcw className="w-5 h-5 animate-spin" />
             <span className="text-sm">載入中...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-950 overflow-hidden text-gray-900 dark:text-gray-50 font-sans">
      
      {/* Mobile Sidebar Backdrop */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-gray-900/50 dark:bg-black/50 z-40 md:hidden transition-opacity" 
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside 
        className={`fixed md:relative inset-y-0 left-0 z-50 shrink-0 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 transition-all duration-300 flex flex-col overflow-hidden shadow-sm ${
          isSidebarOpen ? 'translate-x-0 w-64' : '-translate-x-full md:translate-x-0 md:w-0 w-64'
        }`}
      >
        <div className="h-16 flex items-center px-4 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400">
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
                   : "text-gray-600 dark:text-gray-300 hover:bg-indigo-50 hover:text-indigo-600"
               }`}
             >
               <div className="flex items-center gap-2">
                 <div className={`p-1 rounded-md ${selectedSheet === 'MULTI_FILTER' ? 'bg-white/20 text-white' : 'bg-indigo-50 dark:bg-indigo-900/40 text-indigo-500 dark:text-indigo-400'}`}>
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
                   : "text-gray-600 dark:text-gray-300 hover:bg-pink-50 hover:text-pink-600"
               }`}
             >
               <div className="flex items-center gap-2">
                 <div className={`p-1 rounded-md ${selectedSheet === 'FAVORITES' ? 'bg-white/20 text-white' : 'bg-pink-50 dark:bg-pink-900/40 text-pink-500 dark:text-pink-400'}`}>
                    <Heart className="w-4 h-4" />
                 </div>
                 <span className="truncate">自選股</span>
               </div>
               {selectedSheet === 'FAVORITES' && <ChevronRight className="w-4 h-4 text-pink-200" />}
             </button>
          </div>

          <div className="mb-4">
             <button
               onClick={() => {
                 if (selectedSheet !== 'INSTITUTIONAL_RANKING') {
                    setSelectedSheet('INSTITUTIONAL_RANKING');
                    if (window.innerWidth < 768) setIsSidebarOpen(false);
                 }
               }}
               className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-all duration-200 ${
                 selectedSheet === 'INSTITUTIONAL_RANKING'
                   ? "bg-yellow-600 text-white shadow-md shadow-yellow-200 font-medium"
                   : "text-gray-600 dark:text-gray-300 hover:bg-yellow-50 hover:text-yellow-600"
               }`}
             >
               <div className="flex items-center gap-2">
                 <div className={`p-1 rounded-md ${selectedSheet === 'INSTITUTIONAL_RANKING' ? 'bg-white/20 text-white' : 'bg-yellow-50 dark:bg-yellow-900/40 text-yellow-500 dark:text-yellow-400'}`}>
                    <Trophy className="w-4 h-4" />
                 </div>
                 <span className="truncate">法人買賣超排行</span>
               </div>
               {selectedSheet === 'INSTITUTIONAL_RANKING' && <ChevronRight className="w-4 h-4 text-yellow-200" />}
             </button>
          </div>

          <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3 px-2">工作表清單</h3>
          
          <ul className="space-y-1">
            {visibleSheets.map((sheet, index) => {
              const isIntersectSelected = selectedSheet === 'MULTI_FILTER' && selectedIntersectSheets.includes(sheet);
              return (
              <li 
                 key={sheet}
                 data-index={index}
                 draggable
                 onDragStart={(e) => handleDragStart(e, index)}
                 onDragEnter={(e) => handleDragEnter(e, index)}
                 onDragEnd={handleDragEnd}
                 onDragOver={handleDragOver}
                 className={`transition-all duration-200 flex items-center gap-1 ${dragOverSheetIndex === index ? (draggedSheetIndex !== null && draggedSheetIndex > index ? 'border-t-2 border-indigo-500' : 'border-b-2 border-indigo-500') : 'border-t-2 border-transparent border-b-2 border-transparent'} ${draggedSheetIndex === index ? 'opacity-50' : ''}`}
                 style={{ marginTop: '-2px', marginBottom: '-2px' }}
              >
                <div 
                   className="touch-none p-1 -ml-1 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 cursor-grab active:cursor-grabbing shrink-0"
                   onTouchStart={(e) => handleTouchStart(e, index)}
                   onTouchMove={handleTouchMove}
                   onTouchEnd={handleTouchEnd}
                >
                   <GripVertical className="w-4 h-4" />
                </div>
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
                      ? 'bg-indigo-50 dark:bg-indigo-900/40 text-indigo-700 font-medium' 
                      : isIntersectSelected
                      ? 'bg-indigo-50 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 font-medium'
                      : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-50'
                  }`}
                >
                   <span className="truncate py-0.5">{sheet}</span>
                   {selectedSheet === 'MULTI_FILTER' ? (
                       <div className={`w-4 h-4 rounded shadow-sm flex items-center justify-center shrink-0 border transition-all ${isIntersectSelected ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 group-hover:border-indigo-400'}`}>
                          {isIntersectSelected && <Check className="w-3 h-3" />}
                       </div>
                   ) : (
                       selectedSheet === sheet && <ChevronRight className="w-4 h-4 text-indigo-500 dark:text-indigo-400 mr-1" />
                   )}
                </button>
              </li>
            )})}
          </ul>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full min-w-0 overflow-hidden relative">
        <header className="h-16 shrink-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-4 sm:px-6 shadow-sm z-10">
          <div className="flex items-center gap-3">
            <button 
               onClick={() => setIsSidebarOpen(!isSidebarOpen)}
               className="p-2 -ml-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-50 transition-colors"
            >
               <Menu className="w-5 h-5" />
            </button>
            <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
               {selectedSheet === 'MULTI_FILTER' ? "多重條件交集" : selectedSheet === 'INSTITUTIONAL_RANKING' ? "法人買賣超排行" : (selectedSheet || "載入中...")}
            </h2>
          </div>
          
          <div className="flex items-center gap-2 sm:gap-3">
             {lastFetchTime && (
                <div className="hidden lg:flex items-center text-xs text-gray-500 dark:text-gray-400 font-medium mr-2">
                   最新更新：{lastFetchTime.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
                </div>
             )}
             <div className="flex items-center mr-1 sm:mr-2 lg:mr-4">
                 {!authLoading && (
                   currentUser ? (
                      <div className="flex items-center gap-2 lg:gap-3 bg-white/50 dark:bg-gray-800/50 p-1.5 lg:px-3 lg:py-1.5 rounded-full border border-gray-200 dark:border-gray-700 shadow-sm">
                         {currentUser.photoURL ? (
                            <img src={currentUser.photoURL} alt="User" className="w-6 h-6 rounded-full" referrerPolicy="no-referrer" />
                         ) : (
                            <div className="w-6 h-6 bg-indigo-100 dark:bg-indigo-900/60 rounded-full flex items-center justify-center shrink-0">
                              <User className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                            </div>
                         )}
                         <span className="text-sm font-medium text-gray-700 dark:text-gray-200 hidden lg:block max-w-[120px] truncate">
                            {currentUser.displayName || currentUser.email}
                         </span>
                         <button 
                            onClick={() => signOut(auth)}
                            className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-red-500 transition-colors tooltip"
                            title="登出"
                         >
                            <LogOut className="w-4 h-4" />
                         </button>
                      </div>
                   ) : (
                      <button
                        onClick={handleLogin}
                        className="inline-flex items-center gap-1.5 px-2 py-1.5 lg:px-3 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors shadow-sm"
                      >
                         <User className="w-4 h-4" />
                         <span className="hidden lg:inline">登入以啟用自選股</span>
                      </button>
                   )
                 )}
             </div>
               <button
                 onClick={() => setIsDarkMode(!isDarkMode)}
                 className="p-2 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-100 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg transition-colors shadow-sm dark:bg-gray-800 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-white"
                 title={isDarkMode ? '切換為亮色模式' : '切換為深色模式'}
               >
                  {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
               </button>
               <button
                 onClick={exportToCSV}
                 disabled={loading || sortedData.length === 0}
                 className="flex items-center justify-center p-2 lg:px-3 lg:py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors shadow-sm disabled:opacity-50"
                 title="匯出 CSV"
               >
                  <Download className="w-4 h-4" />
                  <span className="hidden lg:inline ml-1.5">匯出 CSV</span>
               </button>
               <button
                 onClick={() => {
                  if (['MULTI_FILTER', 'FAVORITES', 'INSTITUTIONAL_RANKING'].includes(selectedSheet || '')) {
                     fetchSheets();
                  } else if (selectedSheet) {
                     loadData(selectedSheet, true);
                  }
                }}
                 disabled={loading}
                 className="flex items-center justify-center p-2 lg:px-3 lg:py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors shadow-sm disabled:opacity-50"
                 title="重新整理"
               >
                  <RefreshCcw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                  <span className="hidden lg:inline ml-1.5">重新整理</span>
               </button>
          </div>
        </header>

        <div className="flex-1 flex flex-col p-4 sm:p-6 bg-gray-50 dark:bg-gray-950 overflow-y-auto md:overflow-hidden space-y-4 sm:space-y-6 custom-scrollbar">
            {needsGasUpdate && (
               <div className="bg-amber-50 dark:bg-amber-900/40 border border-amber-200 dark:border-amber-800 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center gap-4 shadow-sm animate-in fade-in slide-in-from-top-4">
                  <div className="flex-1">
                     <h3 className="font-bold text-amber-900 dark:text-amber-400 flex items-center gap-2">
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
              <div className="bg-red-50 dark:bg-red-900/40 border border-red-200 dark:border-red-800 rounded-xl p-6 shadow-sm">
                <h3 className="text-lg font-semibold text-red-900 dark:text-red-400 flex items-center gap-2">
                   <AlertCircle className="w-5 h-5" /> 取資料時發生錯誤
                </h3>
                <p className="text-red-700 mt-2">{error}</p>
              </div>
            ) : selectedSheet === 'INSTITUTIONAL_RANKING' ? (
              <div className="flex-1 overflow-auto bg-gray-50 dark:bg-gray-950 rounded-xl relative border border-gray-200 dark:border-gray-800 shadow-sm max-h-full min-h-0">
                 <InstitutionalRanking allSheetsData={allSheetsData} getSymbol={getSymbol} />
              </div>
            ) : (
              <>
                {selectedSheet === 'MULTI_FILTER' && (
                  <div className="bg-white dark:bg-gray-900 p-5 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm animate-in fade-in shrink-0">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-3 gap-3">
                        <div className="flex items-center gap-2 cursor-pointer" onClick={() => setIsIntersectCollapsed(!isIntersectCollapsed)}>
                            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-50 flex items-center gap-2">
                              <Filter className="w-5 h-5 text-indigo-500 dark:text-indigo-400" />
                              選擇要交集的工作表
                            </h3>
                            <button className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors text-gray-500">
                              {isIntersectCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                            </button>
                        </div>
                        <div className="flex items-center gap-2">
                            {filterPresets.length > 0 && (
                                <div className="flex items-center gap-1">
                                    <select 
                                        className="px-3 py-1.5 bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-700 dark:text-gray-200 outline-none focus:border-indigo-500"
                                        onChange={(e) => {
                                            if (e.target.value) {
                                                const p = filterPresets.find(p => p.id === e.target.value);
                                                if (p) applyPreset(p);
                                                e.target.value = "";
                                            }
                                        }}
                                    >
                                        <option value="">載入儲存的篩選...</option>
                                        {filterPresets.map(p => (
                                            <option key={p.id} value={p.id}>{p.name}</option>
                                        ))}
                                    </select>
                                    <button 
                                        onClick={() => { if(confirm('確定要清空所有儲存的篩選嗎？')) setFilterPresets([]); }}
                                        className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                        title="清空自訂篩選"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            )}
                            <button
                                onClick={handleSavePresetClick}
                                disabled={selectedIntersectSheets.length === 0}
                                className="px-3 py-1.5 bg-indigo-50 dark:bg-indigo-900/40 text-indigo-700 hover:bg-indigo-100 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 disabled:opacity-50"
                            >
                                <BookmarkPlus className="w-4 h-4" />
                                儲存目前篩選
                            </button>
                        </div>
                    </div>
                    {!isIntersectCollapsed && (
                        <div className="flex flex-wrap gap-2">
                          {visibleSheets.map(sheet => {
                              const isSelected = selectedIntersectSheets.includes(sheet);
                              return (
                                <button
                                    key={sheet}
                                    onClick={() => toggleIntersectSheet(sheet)}
                                    className={`px-4 py-2 rounded-full text-sm font-medium border transition-colors ${
                                      isSelected 
                                        ? 'bg-indigo-50 dark:bg-indigo-900/40 border-indigo-200 text-indigo-700 hover:bg-indigo-100' 
                                        : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
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
                    )}
                  </div>
                )}
                {selectedSheet === 'FAVORITES' && (
                  <div className="bg-pink-50 dark:bg-pink-900/40 border border-pink-100 dark:border-pink-800 rounded-xl p-4 shadow-sm flex items-start gap-3 animate-in fade-in shrink-0">
                    <div className="bg-pink-100 text-pink-600 dark:text-pink-400 rounded-full p-1 shrink-0 mt-0.5">
                       <AlertCircle className="w-4 h-4" />
                    </div>
                    <div>
                        <h4 className="text-sm font-semibold text-pink-900 mb-0.5">自選股名單說明</h4>
                        <p className="text-pink-800 text-sm leading-relaxed">如果自選股掉出目前資料庫，它的財務數據、當前股價等欄位，可能會顯示為空白或無資料，直到這支股票重新回到資料庫。</p>
                    </div>
                  </div>
                )}
                {selectedSheet && selectedSheet !== 'MULTI_FILTER' && selectedSheet !== 'FAVORITES' && SHEET_DESCRIPTIONS[selectedSheet] && (
                  <div className="bg-indigo-50 dark:bg-indigo-900/40 border border-indigo-100 dark:border-indigo-800 rounded-xl p-4 shadow-sm flex items-start gap-3 animate-in fade-in shrink-0">
                    <div className="bg-indigo-100 dark:bg-indigo-900/60 text-indigo-600 dark:text-indigo-400 rounded-full p-1 shrink-0 mt-0.5">
                       <AlertCircle className="w-4 h-4" />
                    </div>
                    <div>
                        <h4 className="text-sm font-semibold text-indigo-900 mb-0.5">工作表說明</h4>
                        <p className="text-indigo-800 text-sm leading-relaxed">{SHEET_DESCRIPTIONS[selectedSheet]}</p>
                    </div>
                  </div>
                )}
                {selectedSheet === '美股早報' || selectedSheet === '台股盤後資料AI分析' ? (
                     <div className="flex-1 overflow-auto custom-scrollbar -mx-4 sm:-mx-6 -mb-4 sm:-mb-6">
                        {renderDashboardView()}
                     </div>
                ) : (
                <>
                <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4 shrink-0">
                    <div className="bg-white dark:bg-gray-900 p-5 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm col-span-1">
                        <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">總資料筆數</h3>
                        <p className="text-3xl font-bold mt-1 text-gray-900 dark:text-gray-50">{data.length}</p>
                    </div>
                    <div className="bg-white dark:bg-gray-900 p-5 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm col-span-1">
                        <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">資料欄位數</h3>
                        <p className="text-3xl font-bold mt-1 text-gray-900 dark:text-gray-50">{columns.length}</p>
                    </div>
                    
                    <div className="bg-white dark:bg-gray-900 p-5 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm col-span-1 md:col-span-2 flex flex-wrap items-center gap-3">
                        {availableMonths.length > 0 && (
                            <select
                                value={selectedMonth}
                                onChange={(e) => setSelectedMonth(e.target.value)}
                                className="block w-[140px] md:w-40 py-2.5 px-3 bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white dark:focus:bg-gray-900 transition-all shadow-inner"
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
                                className="block w-[140px] md:w-40 py-2.5 px-3 bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white dark:focus:bg-gray-900 transition-all shadow-inner"
                            >
                                <option value="ALL">全部狀態</option>
                                {availableStatuses.map(s => (
                                    <option key={s} value={s}>{s}</option>
                                ))}
                            </select>
                        )}
                        {availableMotives.length > 0 && (
                            <select
                                value={selectedMotive}
                                onChange={(e) => setSelectedMotive(e.target.value)}
                                className="block w-[140px] md:w-40 py-2.5 px-3 bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white dark:focus:bg-gray-900 transition-all shadow-inner"
                            >
                                <option value="ALL">全部主力誘因</option>
                                {availableMotives.map(m => (
                                    <option key={m} value={m}>{m}</option>
                                ))}
                            </select>
                        )}
                        {availableETFs.length > 0 && (
                            <select
                                value={selectedETF}
                                onChange={(e) => setSelectedETF(e.target.value)}
                                className="block w-[140px] md:w-40 py-2.5 px-3 bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white dark:focus:bg-gray-900 transition-all shadow-inner"
                            >
                                <option value="ALL">全部ETF</option>
                                {availableETFs.map(e => (
                                    <option key={e} value={e}>{e}</option>
                                ))}
                            </select>
                        )}
                        {isCBRadar && (
                            <select
                                value={selectedExpiry}
                                onChange={(e) => setSelectedExpiry(e.target.value)}
                                className="block w-[140px] md:w-40 py-2.5 px-3 bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white dark:focus:bg-gray-900 transition-all shadow-inner"
                            >
                                <option value="ALL">全部到期日</option>
                                <option value="近半年到期">近半年到期</option>
                                <option value="近一年到期">近一年到期</option>
                                <option value="1年~2年">1年~2年</option>
                                <option value="2年以上">2年以上</option>
                                <option value="已到期">已到期</option>
                            </select>
                        )}
                        {availableIndustries.length > 0 && (
                            <select
                                value={selectedIndustry}
                                onChange={(e) => setSelectedIndustry(e.target.value)}
                                className="block w-[140px] md:w-40 py-2.5 px-3 bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white dark:focus:bg-gray-900 transition-all shadow-inner"
                            >
                                <option value="ALL">全部主產業</option>
                                {availableIndustries.map(i => (
                                    <option key={i} value={i}>{i}</option>
                                ))}
                            </select>
                        )}
                        {selectedIndustry !== "ALL" && availableSubIndustries.length > 0 && (
                            <select
                                value={selectedSubIndustry}
                                onChange={(e) => setSelectedSubIndustry(e.target.value)}
                                className="block w-[140px] md:w-40 py-2.5 px-3 bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white dark:focus:bg-gray-900 transition-all shadow-inner"
                            >
                                <option value="ALL">全部細產業</option>
                                {availableSubIndustries.map(i => (
                                    <option key={i} value={i}>{i}</option>
                                ))}
                            </select>
                        )}
                        {selectedSubIndustry !== "ALL" && availableSectors.length > 0 && (
                            <select
                                value={selectedSector}
                                onChange={(e) => setSelectedSector(e.target.value)}
                                className="block w-[140px] md:w-40 py-2.5 px-3 bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white dark:focus:bg-gray-900 transition-all shadow-inner"
                            >
                                <option value="ALL">全部子領域</option>
                                {availableSectors.map(i => (
                                    <option key={i} value={i}>{i}</option>
                                ))}
                            </select>
                        )}
                        <div className="flex-1 shrink-0 w-full xl:w-auto relative">
                            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                                <Search className="h-5 w-5 text-gray-400 dark:text-gray-500" />
                            </div>
                            <input
                                type="text"
                                placeholder="搜尋股票代號、名稱或其他關鍵字..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="block w-full pl-10 pr-4 py-2.5 bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-50 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white dark:focus:bg-gray-900 transition-all shadow-inner"
                            />
                        </div>
                        
                        <div className="relative ml-auto">
                            <button
                                onClick={() => setShowColumnSelector(!showColumnSelector)}
                                className="flex items-center justify-center gap-2 px-4 py-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                title="自訂欄位顯示"
                            >
                                <Columns className="w-4 h-4" />
                                <span className="hidden sm:inline">顯示欄位</span>
                            </button>
                            {showColumnSelector && (
                                <>
                                    <div className="fixed inset-0 z-40" onClick={() => setShowColumnSelector(false)}></div>
                                    <div className="absolute right-0 mt-2 w-56 lg:w-64 bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 z-50 overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
                                        <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 flex items-center justify-between">
                                            <span className="font-semibold text-gray-900 dark:text-gray-50 text-sm">自訂欄位顯示</span>
                                            <button onClick={() => setShowColumnSelector(false)} className="text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-100 bg-white dark:bg-gray-900 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full p-1 transition-colors">
                                                <X className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                        <div className="max-h-[60vh] md:max-h-[300px] overflow-y-auto p-2 flex flex-col gap-0.5 custom-scrollbar">
                                            {columns.map((col, idx) => {
                                                const isSticky = idx < stickyColCount;
                                                return (
                                                <label key={col} className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${isSticky ? 'opacity-50 cursor-not-allowed bg-gray-50 dark:bg-gray-950 text-gray-400 dark:text-gray-500' : 'hover:bg-indigo-50 text-gray-700 dark:text-gray-200'}`}>
                                                    <input 
                                                        type="checkbox" 
                                                        checked={isSticky ? true : !hiddenColumns.has(col)}
                                                        onChange={() => !isSticky && toggleColumnVisibility(col)}
                                                        disabled={isSticky}
                                                        className="w-4 h-4 text-indigo-600 dark:text-indigo-400 border-gray-300 dark:border-gray-600 rounded focus:ring-indigo-500 disabled:opacity-50"
                                                    />
                                                    <span className="text-sm select-none truncate font-medium">{col}</span>
                                                    {isSticky && <span className="ml-auto text-[10px] text-gray-400 dark:text-gray-500 font-semibold bg-gray-200 dark:bg-gray-700 px-1.5 py-0.5 rounded">固定表頭</span>}
                                                </label>
                                            )})}
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>

                <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col shrink-0 min-h-[300px] max-h-[600px] md:max-h-none md:h-auto md:flex-1 md:min-h-0">
                    <div className="overflow-auto custom-scrollbar flex-1 relative">
                    <table className="w-full min-w-max text-sm text-left border-separate border-spacing-0">
                      <thead className="text-xs text-gray-600 dark:text-gray-300 uppercase bg-gray-50 dark:bg-gray-950 border-b border-gray-200 dark:border-gray-700">
                        <tr>
                          {visibleColumns.map((col, idx) => (
                            <th 
                                key={col} 
                                title={`點擊排序 ${col} (支援多重排序)`}
                                onClick={() => handleSort(col)}
                                className={`px-5 py-3.5 font-semibold whitespace-nowrap border-b border-gray-200 dark:border-gray-700 border-r border-gray-100 dark:border-gray-800 last:border-0 cursor-pointer select-none group sticky top-0 bg-gray-50 dark:bg-gray-950 ${idx < stickyColCount ? `z-30 hover:bg-gray-200 dark:hover:bg-gray-700 ${idx === stickyColCount - 1 ? 'shadow-[2px_0_5px_-1px_rgba(0,0,0,0.08)]' : ''}` : 'z-20 shadow-sm hover:bg-gray-200 dark:hover:bg-gray-700/60'}`}
                                style={getStickyStyles(idx)}
                            >
                                <div className="flex items-center gap-1.5">
                                  {col}
                                  {sortConfigs.find(c => c.key === col) ? (
                                     sortConfigs.find(c => c.key === col)?.direction === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" /> : <ArrowDown className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                                  ) : (
                                     <ArrowUpDown className="w-3 h-3 text-gray-400 dark:text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                                  )}
                                  {sortConfigs.length > 1 && sortConfigs.findIndex(c => c.key === col) !== -1 && (
                                     <span className="text-[10px] leading-tight bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 px-1 rounded font-bold shadow-sm">{sortConfigs.findIndex(c => c.key === col) + 1}</span>
                                  )}
                                </div>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {loading && data.length === 0 ? (
                           <tr>
                              <td colSpan={visibleColumns.length || 1} className="px-6 py-20 text-center">
                                 <RefreshCcw className="w-8 h-8 text-indigo-400 animate-spin mx-auto mb-3" />
                                 <p className="text-gray-500 dark:text-gray-400 text-sm">正在載入資料...</p>
                              </td>
                           </tr>
                        ) : selectedSheet === 'MULTI_FILTER' && selectedIntersectSheets.length === 0 ? (
                           <tr>
                              <td colSpan={visibleColumns.length || 1} className="px-6 py-20 text-center">
                                 <Filter className="w-12 h-12 text-indigo-200 mx-auto mb-4" />
                                 <p className="text-gray-500 dark:text-gray-400 text-lg">請選擇至少一個工作表</p>
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
                                        className={`px-5 py-3 max-w-[200px] truncate border-b border-gray-100 dark:border-gray-800 border-r border-gray-50 dark:border-gray-800 last:border-r-0 ${
                                            isNegative ? 'text-rose-600 dark:text-rose-400' : 
                                            isPositive ? 'text-emerald-600 dark:text-emerald-400' : 
                                            'text-gray-700 dark:text-gray-200'
                                        } ${colIdx < stickyColCount ? `sticky bg-white dark:bg-gray-900 z-10 group-hover:bg-indigo-50 dark:group-hover:bg-indigo-900/40 ${colIdx === stickyColCount - 1 ? 'shadow-[2px_0_5px_-1px_rgba(0,0,0,0.05)] shadow-none dark:shadow-[2px_0_5px_-1px_rgba(0,0,0,0.3)]' : ''}` : ''}`}
                                        title={String(formattedValue || '')}
                                        style={getStickyStyles(colIdx)}
                                    >
                                        {colIdx === 0 ? (
                                           <div className="flex items-center gap-2">
                                              <button 
                                                 onClick={(e) => toggleFavorite(e, row)}
                                                 className={`p-1 rounded-full transition-colors ${
                                                    favorites.has(getSymbol(row))
                                                      ? 'text-pink-500 dark:text-pink-400 hover:bg-pink-100'
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
                                <td colSpan={Math.max(visibleColumns.length, 1)} className="px-6 py-16 text-center text-gray-500 dark:text-gray-400">
                                    <LayoutTemplate className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                                    <p>找不到符合的資料</p>
                                </td>
                            </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  {sortedData.length > 0 && (
                     <div className="flex items-center justify-between p-4 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 shrink-0">
                         <div className="text-sm text-gray-500 dark:text-gray-400">
                             顯示 {(currentPage - 1) * pageSize + 1} 至 {Math.min(currentPage * pageSize, sortedData.length)} 筆，共 <span className="font-medium text-gray-900 dark:text-gray-50">{sortedData.length}</span> 筆
                         </div>
                         <div className="flex gap-2">
                             <button 
                                 onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                 disabled={currentPage === 1}
                                 className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
                             >
                                 上一頁
                             </button>
                             <button 
                                 onClick={() => setCurrentPage(p => Math.min(Math.ceil(sortedData.length / pageSize), p + 1))}
                                 disabled={currentPage === Math.ceil(sortedData.length / pageSize) || Math.ceil(sortedData.length / pageSize) === 0}
                                 className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
                             >
                                 下一頁
                             </button>
                         </div>
                     </div>
                  )}
                </div>
                </>
                )}
              </>
            )}
            
            {loading && data.length > 0 && (
               <div className="absolute inset-0 bg-white/50 dark:bg-gray-800/50 backdrop-blur-[1px] flex items-center justify-center z-10 transition-opacity">
                  <div className="bg-white dark:bg-gray-900 p-4 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 flex items-center gap-3">
                     <RefreshCcw className="w-5 h-5 text-indigo-600 dark:text-indigo-400 animate-spin" />
                     <span className="font-medium text-gray-700 dark:text-gray-200">更新資料中...</span>
                  </div>
               </div>
            )}
        </div>
      </main>

      {/* Row Detail Modal for Mobile / Deep View */}
      {selectedRowInfo && (
         <div className="fixed inset-0 bg-gray-900/60 dark:bg-black/60 backdrop-blur-sm z-50 flex flex-col items-center justify-end md:justify-center p-0 md:p-4 animate-in fade-in duration-200">
            <div 
               className="bg-white dark:bg-gray-900 w-full md:max-w-4xl rounded-t-3xl md:rounded-2xl shadow-xl flex flex-col md:max-h-[85vh] max-h-[90vh] animate-in slide-in-from-bottom-8 md:zoom-in-95 duration-300"
            >
               <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-start sm:items-center justify-between bg-white dark:bg-gray-900 rounded-t-3xl md:rounded-t-2xl sticky top-0 z-10 w-full overflow-hidden">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3 w-full pr-4 min-w-0">
                     <h3 className="text-xl font-bold text-gray-900 dark:text-gray-50 flex items-center gap-2 truncate shrink">
                        {getName(selectedRowInfo) || getSymbol(selectedRowInfo) || selectedRowInfo[columns[0]] || '詳細資訊'}
                     </h3>
                     {getSymbol(selectedRowInfo) && (
                        <div className="flex items-center gap-2 flex-wrap pb-1 -mb-1 min-w-0 w-full sm:w-auto">
                           <a 
                              href={`https://tw.stock.yahoo.com/quote/${getSymbol(selectedRowInfo)}/technical-analysis`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/40 hover:bg-indigo-100 border border-indigo-100 dark:border-indigo-800 rounded-lg transition-colors shrink-0"
                              title="查看 Yahoo 奇摩股市技術線圖"
                           >
                              <LineChart className="w-4 h-4" />
                              <span>技術線圖</span>
                              <ExternalLink className="w-3.5 h-3.5 ml-0.5 opacity-70" />
                           </a>
                           <a 
                              href={`https://tw.stock.yahoo.com/quote/${getSymbol(selectedRowInfo)}/institutional-trading`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/40 hover:bg-orange-100 border border-orange-100 dark:border-orange-800 rounded-lg transition-colors shrink-0"
                              title="查看 Yahoo 奇摩股市法人買賣"
                           >
                              <PieChart className="w-4 h-4" />
                              <span>籌碼捷徑</span>
                              <ExternalLink className="w-3.5 h-3.5 ml-0.5 opacity-70" />
                           </a>
                           <a 
                              href={`https://tw.stock.yahoo.com/quote/${getSymbol(selectedRowInfo)}/profile`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-cyan-600 dark:text-cyan-400 bg-cyan-50 dark:bg-cyan-900/40 hover:bg-cyan-100 border border-cyan-100 dark:border-cyan-800 rounded-lg transition-colors shrink-0"
                              title="查看 Yahoo 奇摩股市公司基本資料"
                           >
                              <Building className="w-4 h-4" />
                              <span>基本面</span>
                              <ExternalLink className="w-3.5 h-3.5 ml-0.5 opacity-70" />
                           </a>
                           <a 
                              href={`https://mops.twse.com.tw/mops/#/web/t146sb05?companyId=${getSymbol(selectedRowInfo)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/40 hover:bg-emerald-100 border border-emerald-100 dark:border-emerald-800 rounded-lg transition-colors shrink-0"
                              title="查看公開資訊觀測站公告"
                           >
                              <FileText className="w-4 h-4" />
                              <span>觀測站公告</span>
                              <ExternalLink className="w-3.5 h-3.5 ml-0.5 opacity-70" />
                           </a>
                        </div>
                     )}
                  </div>
                  <button 
                     onClick={() => setSelectedRowInfo(null)} 
                     className="text-gray-400 dark:text-gray-500 hover:text-gray-900 dark:hover:text-gray-50 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full p-2 transition-colors shrink-0 ml-2"
                  >
                     ✕
                  </button>
               </div>
               
               <div className="flex-1 overflow-y-auto p-6 bg-gray-50/50 dark:bg-gray-900/50 dark:bg-black/50 custom-scrollbar">
                  {(() => {
                     let chartData = null;
                     const rowCols = Object.keys(selectedRowInfo);
                     const monthRegex = /^(\d{1,2})月/;
                     const monthCols = rowCols.filter(c => monthRegex.test(c) && !c.includes('增率') && (!isNaN(Number(String(selectedRowInfo[c]).replace(/,/g, ''))) || selectedRowInfo[c] === '')).sort((a, b) => {
                         const ma = parseInt(a.match(monthRegex)?.[1] || "0");
                         const mb = parseInt(b.match(monthRegex)?.[1] || "0");
                         return ma - mb;
                     });
                     
                     if (monthCols.length >= 2) {
                         chartData = {
                            title: '月度數據趨勢',
                            data: monthCols.map(c => ({ name: c.replace('營收', ''), value: Number(String(selectedRowInfo[c] || '0').replace(/,/g, '')) }))
                         };
                     } else {
                         const qRegex = /Q[1-4]$|[1-4]Q$/i;
                         const qCols = rowCols.filter(c => qRegex.test(c) && !isNaN(Number(String(selectedRowInfo[c] || '0').replace(/,/g, '')))).sort();
                         if (qCols.length >= 2) {
                             chartData = {
                                title: '季度數據趨勢',
                                data: qCols.map(c => ({ name: c, value: Number(String(selectedRowInfo[c] || '0').replace(/,/g, '')) }))
                             };
                         } else {
                             const yearRegex = /^(20\d{2}|1\d{2})年?/;
                             const yearCols = rowCols.filter(c => yearRegex.test(c) && !isNaN(Number(String(selectedRowInfo[c] || '0').replace(/,/g, '')))).sort();
                             if (yearCols.length >= 2) {
                                 chartData = {
                                    title: '年度數據趨勢',
                                    data: yearCols.map(c => ({ name: c, value: Number(String(selectedRowInfo[c] || '0').replace(/,/g, '')) }))
                                 };
                             }
                         }
                     }

                     return chartData ? (
                         <div className="mb-6 bg-white dark:bg-gray-900 p-5 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm">
                            <h4 className="text-sm font-bold text-gray-800 dark:text-gray-100 mb-4 flex items-center gap-2">
                               <BarChart3 className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />
                               {chartData.title}
                            </h4>
                            <div className="w-full h-[200px]">
                               <ResponsiveContainer width="100%" height="100%">
                                  <BarChart data={chartData.data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                     <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                     <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#64748b' }} tickLine={false} axisLine={false} />
                                     <YAxis tick={{ fontSize: 12, fill: '#64748b' }} tickLine={false} axisLine={false} tickFormatter={(v) => v >= 100000000 ? `${(v/100000000).toFixed(1)}億` : v >= 10000 ? `${(v/10000).toFixed(0)}萬` : v} />
                                     <RechartsTooltip 
                                        cursor={{ fill: '#f8fafc' }}
                                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)' }}
                                        formatter={(value: number) => [new Intl.NumberFormat('zh-TW').format(value), '數值']}
                                     />
                                     <Bar dataKey="value" fill="#6366f1" radius={[4, 4, 0, 0]} maxBarSize={40} />
                                  </BarChart>
                               </ResponsiveContainer>
                            </div>
                         </div>
                     ) : null;
                  })()}
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                     {(() => {
                        const isDashboardView = selectedSheet === '台股盤後資料AI分析' || selectedSheet === '美股早報';
                        const displayCols = isDashboardView 
                           ? Object.keys(selectedRowInfo).filter(k => k !== '名稱' && k !== '代碼' && k !== '證券代號' && !k.startsWith('_'))
                           : columns;

                        return displayCols.map((col, idx) => {
                           const cellValue = selectedRowInfo[col];
                           const formattedValue = formatCellValue(cellValue);
                           const isNumericStr = !isNaN(Number(cellValue)) && cellValue !== '' && cellValue !== null;
                           const isNegative = isNumericStr && Number(cellValue) < 0;
                           const isPositive = isNumericStr && Number(cellValue) > 0;
                           
                           return (
                              <div key={idx} className="bg-white dark:bg-gray-900 p-4 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm flex flex-col gap-1">
                                 <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{col === '備份日期' ? '日期' : col}</span>
                                 <span className={`text-base font-medium break-words ${
                                    isNegative ? 'text-rose-600 dark:text-rose-400' : 
                                    isPositive ? 'text-emerald-600 dark:text-emerald-400' : 
                                    'text-gray-900 dark:text-gray-50'
                                 }`}>
                                    {formattedValue || '-'}
                                 </span>
                              </div>
                           );
                        });
                     })()}
                  </div>
               </div>
               
               <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 flex justify-end shrink-0 rounded-b-2xl">
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

      {/* Save Preset Modal */}
      {showPresetModal && (
         <div className="fixed inset-0 bg-gray-900/40 dark:bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-gray-900 w-full max-w-sm rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
               <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between bg-gray-50 dark:bg-gray-950">
                  <h3 className="text-lg font-bold text-gray-900 dark:text-gray-50 flex items-center gap-2">
                     <BookmarkPlus className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                     儲存篩選組合
                  </h3>
                  <button onClick={() => setShowPresetModal(false)} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 transition-colors">
                     <X className="w-5 h-5" />
                  </button>
               </div>
               <div className="p-6">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">名稱</label>
                  <input
                     type="text"
                     value={presetNameInput}
                     onChange={(e) => setPresetNameInput(e.target.value)}
                     className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                     placeholder="例如: 勝率篩選 (基本+技術)"
                     autoFocus
                     onKeyDown={(e) => {
                         if (e.key === 'Enter') confirmSavePreset();
                     }}
                  />
               </div>
               <div className="px-6 py-4 bg-gray-50 dark:bg-gray-950 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3 rounded-b-2xl">
                  <button
                     onClick={() => setShowPresetModal(false)}
                     className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  >
                     取消
                  </button>
                  <button
                     onClick={confirmSavePreset}
                     className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors shadow-sm flex items-center gap-2"
                  >
                     儲存
                  </button>
               </div>
            </div>
         </div>
      )}

      {/* GAS Code Modal */}
      {showGasCode && (
         <div className="fixed inset-0 bg-gray-900/40 dark:bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-gray-900 w-full max-w-3xl rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-200">
               <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between bg-gray-50 dark:bg-gray-950">
                  <h3 className="text-lg font-bold text-gray-900 dark:text-gray-50 flex items-center gap-2">
                     <Code className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                     GAS 網頁應用程式部署程式碼
                  </h3>
                  <button onClick={() => setShowGasCode(false)} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 p-1">
                     ✕
                  </button>
               </div>
               <div className="flex-1 overflow-y-auto p-6 bg-white dark:bg-gray-900 space-y-6">
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800 leading-relaxed">
                     <p className="font-semibold mb-1 flex items-center gap-2">
                        <AlertCircle className="w-4 h-4" />
                        請更新您的 Apps Script
                     </p>
                     為了支援打開網頁時就載入所有資料、達到秒切工作表的效果，我們更新了程式碼，加入了 <code>action=getAllData</code> 的支援。請將下方完整的程式碼貼到 Apps Script 後，建立<strong>新的部署作業</strong>（或在原先的部署上選「新增版本」）以套用這個更新！
                  </div>
                  
                  <div className="bg-gray-900 rounded-xl border border-gray-800 shadow-inner overflow-hidden">
                     <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700 bg-gray-800/50">
                        <span className="text-gray-400 dark:text-gray-500 text-xs font-mono">Code.gs</span>
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
                     <h4 className="font-bold text-gray-900 dark:text-gray-50 mb-2">部署教學：</h4>
                     <ol className="list-decimal pl-5 space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
                        <li>前往試算表，點擊頂部選單 <strong className="text-gray-800 dark:text-gray-100">「擴充功能」 {'>'} 「Apps Script」</strong>。</li>
                        <li>刪除原有的程式碼，貼上上方複製的內容。</li>
                        <li>點擊右上方的 <strong className="text-gray-800 dark:text-gray-100">「部署」 {'>'} 「管理部署作業」</strong>（或「新增部署作業」）。</li>
                        <li>如果是管理部署作業，點擊右上角鉛筆（編輯），然後將「版本」選為 <strong className="text-gray-800 dark:text-gray-100">建立新版本</strong>。</li>
                        <li>按下 <strong className="text-gray-800 dark:text-gray-100">部署</strong>，即可完成更新！介面將自動抓取多個工作表。</li>
                     </ol>
                  </div>
               </div>
               <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 flex justify-end">
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
