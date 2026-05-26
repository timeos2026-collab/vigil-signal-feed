import React, { useState, useEffect } from 'react';
import { Activity, MapPin, Shield, Filter, RefreshCw, Box } from 'lucide-react';

interface Signal {
  id: string;
  created_at: string;
  commodity_tags: string[];
  confidence_score: string;
  region: string;
  asset_identifier: string;
  raw_payload: any;
}

const App: React.FC = () => {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [regionFilter, setRegionFilter] = useState('');
  const [commodityFilter, setCommodityFilter] = useState('');

  const fetchSignals = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (regionFilter) params.append('region', regionFilter);
      if (commodityFilter) params.append('commodity', commodityFilter);

      const response = await fetch(`http://localhost:3000/api/signals?${params.toString()}`, {
        headers: {
          'Authorization': 'Bearer local-dev-token'
        }
      });
      
      if (!response.ok) throw new Error('Failed to fetch signals');
      
      const data = await response.json();
      setSignals(data);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSignals();
    const interval = setInterval(fetchSignals, 10000); // Auto-refresh every 10s
    return () => clearInterval(interval);
  }, [regionFilter, commodityFilter]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-8 font-sans">
      <header className="flex justify-between items-center mb-8 border-b border-slate-800 pb-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Activity className="text-emerald-500" size={32} />
            VIGIL Signal Feed
          </h1>
          <p className="text-slate-400 mt-1">Real-time Oil & Gas Market Intelligence</p>
        </div>
        <div className="flex gap-4">
          <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2">
            <Filter size={18} className="text-slate-500" />
            <select 
              className="bg-transparent border-none outline-none text-sm text-slate-100"
              value={commodityFilter}
              onChange={(e) => setCommodityFilter(e.target.value)}
            >
              <option value="" className="bg-slate-900">All Commodities</option>
              <option value="crude_oil" className="bg-slate-900">Crude Oil</option>
              <option value="natural_gas" className="bg-slate-900">Natural Gas</option>
              <option value="lng" className="bg-slate-900">LNG</option>
              <option value="refined_products" className="bg-slate-900">Refined Products</option>
            </select>
          </div>
          <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2">
            <MapPin size={18} className="text-slate-500" />
            <select 
              className="bg-transparent border-none outline-none text-sm text-slate-100"
              value={regionFilter}
              onChange={(e) => setRegionFilter(e.target.value)}
            >
              <option value="" className="bg-slate-900">All Regions</option>
              <option value="Permian" className="bg-slate-900">Permian</option>
              <option value="Gulf Coast" className="bg-slate-900">Gulf Coast</option>
              <option value="North Sea" className="bg-slate-900">North Sea</option>
              <option value="Cushing" className="bg-slate-900">Cushing</option>
              <option value="Rotterdam" className="bg-slate-900">Rotterdam</option>
              <option value="Singapore" className="bg-slate-900">Singapore</option>
            </select>
          </div>
          <button 
            onClick={fetchSignals}
            className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
          >
            <RefreshCw size={20} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </header>

      {error && (
        <div className="bg-red-900/20 border border-red-800 text-red-400 p-4 rounded-lg mb-8">
          Error: {error}
        </div>
      )}

      <div className="grid gap-4">
        {loading && signals.length === 0 ? (
          <div className="text-center py-20 text-slate-500">Loading initial signals...</div>
        ) : signals.length === 0 ? (
          <div className="text-center py-20 text-slate-500">No signals found matching filters.</div>
        ) : (
          <div className="overflow-x-auto bg-slate-900 border border-slate-800 rounded-xl">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-900/50">
                  <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-slate-500">Asset</th>
                  <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-slate-500">Commodity</th>
                  <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-slate-500">Confidence</th>
                  <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-slate-500">Region</th>
                  <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-slate-500">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {signals.map((signal) => (
                  <tr key={signal.id} className="hover:bg-slate-800/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <Box size={18} className="text-blue-500" />
                        <span className="font-medium">{signal.asset_identifier}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex gap-1">
                        {signal.commodity_tags && signal.commodity_tags.length > 0 ? (
                          signal.commodity_tags.map(tag => (
                            <span key={tag} className="px-2 py-0.5 rounded bg-emerald-900/30 text-emerald-400 text-xs border border-emerald-800/50">
                              {tag.replace('_', ' ')}
                            </span>
                          ))
                        ) : (
                          <span className="text-slate-600 text-xs italic">No tags</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <Shield size={14} className={parseFloat(signal.confidence_score) > 0.7 ? "text-emerald-500" : "text-amber-500"} />
                        <span className="text-sm">{(parseFloat(signal.confidence_score) * 100).toFixed(0)}%</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-300">
                      {signal.region}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-400">
                      {new Date(signal.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
