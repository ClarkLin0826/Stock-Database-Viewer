import React, { useMemo } from 'react';
import { Trophy, TrendingUp, TrendingDown, ArrowRight } from 'lucide-react';

interface InstitutionalRankingProps {
  allSheetsData: Record<string, any[]>;
  getSymbol: (row: any) => string;
}

const parseVal = (val: any) => {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  const str = String(val).replace(/,/g, '');
  return parseFloat(str) || 0;
};

export const InstitutionalRanking: React.FC<InstitutionalRankingProps> = ({ allSheetsData, getSymbol }) => {
  const data = allSheetsData['上市櫃三大法人買賣超'] || [];

  const updateDate = useMemo(() => {
    if (data.length > 0 && data[0]['更新日期']) {
       return data[0]['更新日期'];
    }
    return '';
  }, [data]);

  const priceChangeMap = useMemo(() => {
    const map = new Map<string, string | number>();
    for (const row of data) {
        const sym = getSymbol(row);
        if (!sym) continue;
        const pct = row['今日漲跌幅(%)'] || row['今日漲跌幅'] || row['漲跌幅(%)'] || row['漲跌幅'] || row['日漲跌幅(%)'] || row['日漲跌幅'] || row['最新漲跌幅'] || row['最新漲跌幅(%)'];
        if (pct !== undefined && pct !== null && pct !== '' && !map.has(sym)) {
            map.set(sym, pct);
        }
    }
    return map;
  }, [data, getSymbol]);

  const getRankings = (columnKeys: string[], isBuy: boolean) => {
    // Find the first column key that actually exists in our data
    let actualColumn = columnKeys[0];
    if (data.length > 0) {
      const found = columnKeys.find(key => data[0][key] !== undefined);
      if (found) actualColumn = found;
    }

    const validRows = data.filter(row => parseVal(row[actualColumn]) !== 0);
    const sorted = [...validRows].sort((a, b) => {
      const valA = parseVal(a[actualColumn]);
      const valB = parseVal(b[actualColumn]);
      return isBuy ? valB - valA : valA - valB;
    });
    
    // Filter to positive for buy, negative for sell
    const filtered = sorted.filter(row => {
        const val = parseVal(row[actualColumn]);
        return isBuy ? val > 0 : val < 0;
    });

    return filtered.slice(0, 20).map(row => {
        const symbol = row['證券代號'] || getSymbol(row);
        return {
           symbol,
           name: row['證券名稱'],
           market: row['市場別'],
           value: Math.round(parseVal(row[actualColumn]) / 1000),
           priceChange: priceChangeMap.get(symbol) || '-'
        };
    });
  };

  const categories = [
    { title: '三大法人', columns: ['三大法人買賣超股數', '三大法人買賣超'] },
    { title: '外資', columns: ['外陸資買賣超股數(不含外資自營商)', '外資買賣超'] },
    { title: '投信', columns: ['投信買賣超股數', '投信買賣超'] },
    { title: '自營自行', columns: ['自營商買賣超股數(自行買賣)', '自營自行買賣超'] },
    { title: '自營避險', columns: ['自營商買賣超股數(避險)', '自營避險買賣超'] }
  ];

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('en-US').format(num);
  };

  const formatPriceChange = (val: any) => {
    if (val === '-' || !val) return '-';
    let strVal = String(val).trim();
    if (!strVal.endsWith('%') && !isNaN(parseFloat(strVal))) {
      return `${strVal}%`;
    }
    return strVal;
  };

  if (data.length === 0) {
     return (
       <div className="flex flex-col items-center justify-center h-full p-8 text-gray-500">
         <Trophy className="w-12 h-12 mb-4 text-indigo-200" />
         <p>目前沒有「上市櫃三大法人買賣超」的資料</p>
       </div>
     );
  }

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-8 animate-in fade-in">
      <div className="flex items-center justify-between mb-6 border-b border-gray-200 dark:border-gray-800 pb-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
             <Trophy className="w-6 h-6 text-yellow-500" />
             法人買賣超排行 TOP 20
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">資料來源：上市櫃三大法人買賣超</p>
        </div>
        <div className="flex flex-col items-end gap-2 text-right">
          {updateDate && (
            <div className="text-sm bg-gray-100 dark:bg-gray-800 px-3 py-1.5 rounded-md text-gray-600 dark:text-gray-300">
              更新日期：{updateDate}
            </div>
          )}
          <div className="text-xs text-gray-500 dark:text-gray-400 px-1">
            * 交易日17:00更新
          </div>
        </div>
      </div>

      <div className="space-y-12">
         {categories.map((cat, idx) => {
            const buys = getRankings(cat.columns, true);
            const sells = getRankings(cat.columns, false);

            return (
               <div key={cat.title} className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-800 overflow-hidden">
                  <div className="bg-gray-50 dark:bg-gray-800/50 px-6 py-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
                     <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100">{cat.title}</h3>
                  </div>
                  
                  <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-gray-200 dark:divide-gray-800">
                     {/* Buy Section */}
                     <div className="p-0">
                        <div className="px-4 py-3 bg-red-50/50 dark:bg-red-900/10 flex items-center gap-2 border-b border-red-100 dark:border-red-900/30">
                           <TrendingUp className="w-5 h-5 text-red-500" />
                           <h4 className="font-semibold text-red-700 dark:text-red-400">買超 TOP 20</h4>
                        </div>
                        <div className="overflow-x-auto">
                           <table className="w-full text-sm text-left">
                             <thead className="text-xs text-gray-500 uppercase bg-gray-50/50 dark:bg-gray-800/30">
                                <tr>
                                  <th className="px-4 py-2 font-medium">排名</th>
                                  <th className="px-4 py-2 font-medium">代號</th>
                                  <th className="px-4 py-2 font-medium">名稱</th>
                                  <th className="px-4 py-2 font-medium">市場別</th>
                                  <th className="px-4 py-2 font-medium text-right">買超張數</th>
                                  <th className="px-4 py-2 font-medium text-right">漲跌幅</th>
                                </tr>
                             </thead>
                             <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                {buys.map((item, i) => (
                                   <tr key={item.symbol} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                                      <td className="px-4 py-2 text-gray-500">{i + 1}</td>
                                      <td className="px-4 py-2 font-medium text-indigo-600 dark:text-indigo-400">{item.symbol}</td>
                                      <td className="px-4 py-2 text-gray-900 dark:text-gray-100">{item.name}</td>
                                      <td className="px-4 py-2 text-gray-500">{item.market}</td>
                                      <td className="px-4 py-2 text-right text-red-600 font-medium">{formatNumber(item.value)}</td>
                                      <td className={`px-4 py-2 text-right ${String(item.priceChange).includes('-') ? 'text-green-600 dark:text-green-400' : (item.priceChange !== '-' && parseFloat(String(item.priceChange)) > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-600 dark:text-gray-400')}`}>
                                        {formatPriceChange(item.priceChange)}
                                      </td>
                                   </tr>
                                ))}
                                {buys.length === 0 && (
                                   <tr>
                                      <td colSpan={6} className="px-4 py-6 text-center text-gray-500">無資料</td>
                                   </tr>
                                )}
                             </tbody>
                           </table>
                        </div>
                     </div>

                     {/* Sell Section */}
                     <div className="p-0">
                        <div className="px-4 py-3 bg-green-50/50 dark:bg-green-900/10 flex items-center gap-2 border-b border-green-100 dark:border-green-900/30">
                           <TrendingDown className="w-5 h-5 text-green-500" />
                           <h4 className="font-semibold text-green-700 dark:text-green-400">賣超 TOP 20</h4>
                        </div>
                        <div className="overflow-x-auto">
                           <table className="w-full text-sm text-left">
                             <thead className="text-xs text-gray-500 uppercase bg-gray-50/50 dark:bg-gray-800/30">
                                <tr>
                                  <th className="px-4 py-2 font-medium">排名</th>
                                  <th className="px-4 py-2 font-medium">代號</th>
                                  <th className="px-4 py-2 font-medium">名稱</th>
                                  <th className="px-4 py-2 font-medium">市場別</th>
                                  <th className="px-4 py-2 font-medium text-right">賣超張數</th>
                                  <th className="px-4 py-2 font-medium text-right">漲跌幅</th>
                                </tr>
                             </thead>
                             <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                {sells.map((item, i) => (
                                   <tr key={item.symbol} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                                      <td className="px-4 py-2 text-gray-500">{i + 1}</td>
                                      <td className="px-4 py-2 font-medium text-indigo-600 dark:text-indigo-400">{item.symbol}</td>
                                      <td className="px-4 py-2 text-gray-900 dark:text-gray-100">{item.name}</td>
                                      <td className="px-4 py-2 text-gray-500">{item.market}</td>
                                      <td className="px-4 py-2 text-right text-green-600 font-medium">{formatNumber(item.value)}</td>
                                      <td className={`px-4 py-2 text-right ${String(item.priceChange).includes('-') ? 'text-green-600 dark:text-green-400' : (item.priceChange !== '-' && parseFloat(String(item.priceChange)) > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-600 dark:text-gray-400')}`}>
                                        {formatPriceChange(item.priceChange)}
                                      </td>
                                   </tr>
                                ))}
                                {sells.length === 0 && (
                                   <tr>
                                      <td colSpan={6} className="px-4 py-6 text-center text-gray-500">無資料</td>
                                   </tr>
                                )}
                             </tbody>
                           </table>
                        </div>
                     </div>
                  </div>
               </div>
            );
         })}
      </div>
    </div>
  );
};
