const fs = require('fs');
const content = fs.readFileSync('src/App.tsx', 'utf-8');
const lines = content.split('\n');

// We want to keep lines 0 to 430 (which is up to index 430). The 431th line is "<div className="bg-gray-900 rounded-xl..." which we will append manually.
// Wait, index 430 is line 431. Let's verify line numbers.
// line 431 is index 430: '<div className="bg-gray-900...'
const goodLines = lines.slice(0, 430);
const suffix = `                  <div className="bg-gray-900 rounded-xl border border-gray-800 shadow-inner overflow-hidden">
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
`;

fs.writeFileSync('src/App.tsx', goodLines.join('\n') + '\n' + suffix);
