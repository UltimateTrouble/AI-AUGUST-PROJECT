import React, { useState, useEffect } from 'react';
import { 
  Search, 
  MapPin, 
  Wind, 
  Droplets, 
  Thermometer, 
  CloudRain, 
  Sun, 
  Cloud, 
  CloudLightning,
  AlertTriangle,
  Loader2,
  CalendarDays,
  BarChart3,
  Calendar,
  BookOpen,
  Waves,
  Flame,
  Map,
  Globe
} from 'lucide-react';

// Helper to parse NOAA CPC MapServer identify results
const parseCPCData = (tempData, precipData) => {
    const outlooks = [];
    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const fullMonths = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

    const extractOutlook = (result) => {
        if (!result || !result.attributes) return { cat: 'Equal Chances', prob: null, description: 'Equal chances of above, near, or below normal conditions.' };
        
        const attrs = result.attributes;
        const cat = attrs.Cat || attrs.CAT || attrs.cat || attrs.Category || 'EC';
        const probRaw = attrs.Prob || attrs.PROB || attrs.prob || attrs.Probability;
        const prob = probRaw ? parseFloat(probRaw).toFixed(0) : null;

        let formattedCat = 'Equal Chances';
        let desc = 'Equal chances of above, near, or below normal conditions.';
        
        if (cat.toUpperCase().startsWith('A')) {
            formattedCat = 'Above Normal';
            desc = `Leans toward above normal conditions (${prob}% probability).`;
        } else if (cat.toUpperCase().startsWith('B')) {
            formattedCat = 'Below Normal';
            desc = `Leans toward below normal conditions (${prob}% probability).`;
        } else if (cat.toUpperCase().startsWith('N')) {
            formattedCat = 'Near Normal';
            desc = `Leans toward near normal conditions (${prob}% probability).`;
        }
        
        return { cat: formattedCat, prob, description: desc };
    };

    for (let i = 0; i < 13; i++) {
        const tResult = tempData?.results?.find(r => r.layerId === i);
        const pResult = precipData?.results?.find(r => r.layerId === i);

        // NWS CPC leads overlap by 3 months. Lead 1 starts next month.
        const m1Idx = (currentMonth + 1 + i) % 12;
        const m2Idx = (currentMonth + 2 + i) % 12;
        const m3Idx = (currentMonth + 3 + i) % 12;
        
        const yearOffset1 = Math.floor((currentMonth + 1 + i) / 12);
        const yearOffset3 = Math.floor((currentMonth + 3 + i) / 12);
        
        const shortName = `${months[m1Idx]}${months[m2Idx]}${months[m3Idx]}`;
        const title = `${fullMonths[m1Idx]} - ${fullMonths[m3Idx]} ${currentYear + yearOffset3}`;
        const yearRange = yearOffset1 !== yearOffset3 ? `${currentYear + yearOffset1}-${currentYear + yearOffset3}` : `${currentYear + yearOffset1}`;

        outlooks.push({
            id: i,
            shortName,
            title,
            year: yearRange,
            temp: extractOutlook(tResult),
            precip: extractOutlook(pResult)
        });
    }
    return outlooks;
};

// UI Color Helper for Climate Categories
const getCatColor = (cat, type) => {
    if (cat === 'Above Normal') return type === 'temp' ? 'text-red-700 bg-red-50 border-red-200' : 'text-teal-700 bg-teal-50 border-teal-200';
    if (cat === 'Below Normal') return type === 'temp' ? 'text-blue-700 bg-blue-50 border-blue-200' : 'text-amber-700 bg-amber-50 border-amber-200';
    if (cat === 'Near Normal') return 'text-emerald-700 bg-emerald-50 border-emerald-200';
    return 'text-slate-600 bg-slate-50 border-slate-200'; // Equal Chances
};

const WeatherApp = () => {
  // State management
  const [zipCode, setZipCode] = useState('90401'); // Default to Santa Monica, CA
  const [locationName, setLocationName] = useState('');
  const [forecast, setForecast] = useState(null);
  const [currentWeather, setCurrentWeather] = useState(null);
  const [cpcOutlooks, setCpcOutlooks] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('daily'); // 'daily', 'hourly', or 'climate'
  const [selectedClimateMonth, setSelectedClimateMonth] = useState(0);
  const [mainTab, setMainTab] = useState('forecast'); // 'forecast' or 'education'

  // Function to handle the search process
  const handleSearch = async (e) => {
    if (e) e.preventDefault();
    if (!zipCode || zipCode.length !== 5 || isNaN(zipCode)) {
      setError('Please enter a valid 5-digit US zip code.');
      return;
    }

    setLoading(true);
    setError('');
    setForecast(null);
    setCurrentWeather(null);
    setLocationName('');

    try {
      // Step 1: Convert Zip Code to Lat/Lon using a free geocoding API (Zippopotam.us)
      const geoResponse = await fetch(`https://api.zippopotam.us/us/${zipCode}`);
      if (!geoResponse.ok) {
        throw new Error('Zip code not found. Please check and try again.');
      }
      const geoData = await geoResponse.json();
      
      const placeName = geoData.places[0]['place name'];
      const stateAbbr = geoData.places[0]['state abbreviation'];
      const lat = geoData.places[0].latitude;
      const lon = geoData.places[0].longitude;
      
      setLocationName(`${placeName}, ${stateAbbr}`);

      // Step 2: Get NWS grid points for the coordinates
      // The NWS API requires a User-Agent header, though often works without one in browsers
      const nwsPointsUrl = `https://api.weather.gov/points/${lat},${lon}`;
      const pointsResponse = await fetch(nwsPointsUrl);
      
      if (!pointsResponse.ok) {
         if (pointsResponse.status === 404) {
             throw new Error('Weather data not available for this location via NWS.');
         }
         throw new Error('Failed to reach the National Weather Service API.');
      }
      const pointsData = await pointsResponse.json();

      // Step 3: Fetch the actual forecast data and official CPC GIS data
      const forecastUrl = pointsData.properties.forecast;
      const forecastHourlyUrl = pointsData.properties.forecastHourly;

      // Construct NOAA CPC MapServer identify URLs for 13-month seasonal outlooks
      const extent = `${lon-0.5},${lat-0.5},${lon+0.5},${lat+0.5}`;
      const cpcParams = new URLSearchParams({
        geometry: `${lon},${lat}`,
        geometryType: 'esriGeometryPoint',
        sr: '4326',
        layers: 'all',
        tolerance: '2',
        mapExtent: extent,
        imageDisplay: '800,600,96',
        returnGeometry: 'false',
        f: 'json'
      }).toString();

      const cpcTempUrl = `https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/cpc_sea_temp_outlk/MapServer/identify?${cpcParams}`;
      const cpcPrecipUrl = `https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/cpc_sea_precip_outlk/MapServer/identify?${cpcParams}`;

      const [forecastRes, hourlyRes, cpcTempRes, cpcPrecipRes] = await Promise.all([
        fetch(forecastUrl),
        fetch(forecastHourlyUrl),
        fetch(cpcTempUrl).catch(() => ({ ok: false })),
        fetch(cpcPrecipUrl).catch(() => ({ ok: false }))
      ]);

      if (!forecastRes.ok || !hourlyRes.ok) {
        throw new Error('Failed to retrieve forecast data.');
      }

      const forecastData = await forecastRes.json();
      const hourlyData = await hourlyRes.json();
      
      // Attempt to parse official CPC data if successful
      if (cpcTempRes.ok && cpcPrecipRes.ok) {
          try {
              const tempData = await cpcTempRes.json();
              const precipData = await cpcPrecipRes.json();
              setCpcOutlooks(parseCPCData(tempData, precipData));
          } catch(e) {
              console.warn("Could not parse NOAA CPC data", e);
              setCpcOutlooks(null);
          }
      } else {
          setCpcOutlooks(null);
      }

      // Set the detailed forecast for the periods
      setForecast({
        daily: forecastData.properties.periods,
        hourly: hourlyData.properties.periods.slice(0, 24) // Just get next 24 hours
      });

      // Use the first hourly period as the "current" weather
      setCurrentWeather(hourlyData.properties.periods[0]);

    } catch (err) {
      console.error(err);
      setError(err.message || 'An unexpected error occurred while fetching weather data.');
    } finally {
      setLoading(false);
    }
  };

  // Initial Load Effect for California focus
  useEffect(() => {
    if (!forecast && !loading && !error) {
      handleSearch();
    }
  }, []);

  // Helper to choose an icon based on NWS shortForecast string
  const getWeatherIcon = (shortForecast, isDaytime = true) => {
    const forecast = shortForecast.toLowerCase();
    if (forecast.includes('rain') || forecast.includes('shower') || forecast.includes('drizzle')) return <CloudRain className="w-8 h-8 text-blue-500" />;
    if (forecast.includes('thunder')) return <CloudLightning className="w-8 h-8 text-yellow-600" />;
    if (forecast.includes('snow') || forecast.includes('ice') || forecast.includes('flurries')) return <CloudRain className="w-8 h-8 text-blue-200" />; // Fallback since no snow icon
    if (forecast.includes('cloud') || forecast.includes('overcast')) return <Cloud className="w-8 h-8 text-gray-400" />;
    if (forecast.includes('sun') || forecast.includes('clear')) return isDaytime ? <Sun className="w-8 h-8 text-yellow-400" /> : <Cloud className="w-8 h-8 text-indigo-300" />; // Moon fallback
    
    return isDaytime ? <Sun className="w-8 h-8 text-yellow-400" /> : <Cloud className="w-8 h-8 text-indigo-300" />;
  };

  // Helper to format timestamps
  const formatTime = (isoString) => {
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: 'numeric' });
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-8">
        
        {/* Header & Search Area */}
        <header className="bg-white rounded-2xl shadow-sm p-6 md:p-8 border border-slate-100 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="text-center md:text-left">
            <h1 className="text-3xl font-bold text-blue-900 tracking-tight flex items-center justify-center md:justify-start gap-2">
              <Sun className="text-yellow-500" />
              NWS Explorer: CA Edition
            </h1>
            <p className="text-slate-500 mt-1 text-sm">California-Focused Weather & Climate</p>
          </div>

          <form onSubmit={handleSearch} className="w-full md:w-auto relative group">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-5 w-5 text-slate-400 group-focus-within:text-blue-500 transition-colors" />
            </div>
            <input
              type="text"
              value={zipCode}
              onChange={(e) => setZipCode(e.target.value.replace(/\D/g, '').slice(0, 5))}
              placeholder="Enter US Zip Code..."
              className="block w-full md:w-80 pl-10 pr-24 py-3 border border-slate-200 rounded-xl leading-5 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all sm:text-sm"
              maxLength="5"
            />
            <button
              type="submit"
              disabled={loading || zipCode.length !== 5}
              className="absolute inset-y-1 right-1 px-4 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Search'}
            </button>
          </form>
        </header>

        {/* Main Application Navigation */}
        <div className="flex gap-2 p-1 bg-white rounded-xl shadow-sm border border-slate-100 w-fit mx-auto md:mx-0">
          <button
            onClick={() => setMainTab('forecast')}
            className={`px-8 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
              mainTab === 'forecast' 
                ? 'bg-blue-600 text-white shadow-sm' 
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            Live Forecast
          </button>
          <button
            onClick={() => setMainTab('education')}
            className={`px-8 py-2.5 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2 ${
              mainTab === 'education' 
                ? 'bg-blue-600 text-white shadow-sm' 
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <BookOpen className="w-4 h-4" />
            CA Weather Guide
          </button>
        </div>

        {/* View Routing - Forecast */}
        {mainTab === 'forecast' && (
          <div className="space-y-8">
            {/* Error Message */}
            {error && (
              <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-r-lg flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                <p className="text-red-700 text-sm font-medium">{error}</p>
              </div>
            )}

            {/* Current Weather Hero */}
            {currentWeather && (
              <div className="bg-gradient-to-br from-blue-600 to-indigo-800 rounded-3xl p-6 md:p-10 text-white shadow-xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-white opacity-5 rounded-full -translate-y-1/2 translate-x-1/4 blur-3xl pointer-events-none"></div>
                
                <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-8">
                  <div className="flex flex-col gap-4 text-center md:text-left w-full md:w-auto">
                    
                    <div className="flex items-center gap-2 text-blue-100 bg-white/10 px-3 py-1 rounded-full w-fit text-sm font-medium backdrop-blur-sm mx-auto md:mx-0">
                      <MapPin className="w-4 h-4" />
                      {locationName}
                    </div>
                    
                    <div className="flex items-end justify-center md:justify-start gap-4">
                      <h2 className="text-6xl md:text-8xl font-bold tracking-tighter">
                        {currentWeather.temperature}°
                      </h2>
                      <div className="pb-2 md:pb-4 text-left">
                        <p className="text-2xl md:text-3xl font-medium">{currentWeather.shortForecast}</p>
                        <p className="text-blue-100 flex items-center justify-center md:justify-start gap-1 mt-1 text-sm md:text-base">
                          <Wind className="w-4 h-4" />
                          {currentWeather.windSpeed} {currentWeather.windDirection}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="p-6 bg-white/10 rounded-2xl backdrop-blur-md border border-white/20 flex flex-col items-center justify-center w-32 h-32 md:w-40 md:h-40 shrink-0">
                     <div className="transform scale-150">
                        {getWeatherIcon(currentWeather.shortForecast, currentWeather.isDaytime)}
                     </div>
                  </div>

                </div>
              </div>
            )}

            {/* Loading State */}
            {loading && (
              <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-16 flex flex-col items-center justify-center text-center animate-in fade-in duration-300">
                <Loader2 className="w-12 h-12 animate-spin text-blue-500 mb-4" />
                <p className="text-lg text-slate-600 font-medium">Analyzing Atmosphere...</p>
                <p className="text-sm text-slate-400 mt-1">Fetching latest NWS & CPC data</p>
              </div>
            )}

            {/* Forecast Navigation */}
            {!loading && (
            <div className="flex gap-2 p-1 bg-white rounded-xl shadow-sm border border-slate-100 w-fit flex-wrap">
              <button
                onClick={() => setActiveTab('daily')}
                className={`px-6 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === 'daily' 
                    ? 'bg-blue-50 text-blue-700' 
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                7-Day Forecast
              </button>
              <button
                onClick={() => setActiveTab('hourly')}
                className={`px-6 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === 'hourly' 
                    ? 'bg-blue-50 text-blue-700' 
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                24-Hour Forecast
              </button>
              <button
                onClick={() => setActiveTab('climate')}
                className={`px-6 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                  activeTab === 'climate' 
                    ? 'bg-blue-50 text-blue-700' 
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <CalendarDays className="w-4 h-4" />
                CPC Seasonal Outlooks
              </button>
            </div>
            )}

            {/* Forecast Content Area */}
            {!loading && (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
              
              {/* Daily/Period Forecast */}
              {activeTab === 'daily' && forecast?.daily && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {forecast.daily.map((period, index) => (
                    <div 
                      key={index} 
                      className="p-5 rounded-xl border border-slate-100 bg-slate-50 hover:bg-white hover:shadow-md transition-all group flex flex-col justify-between"
                    >
                      <div className="flex justify-between items-start mb-4">
                        <div>
                          <h4 className="font-semibold text-slate-800">{period.name}</h4>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-2xl font-bold text-blue-900">{period.temperature}°</span>
                            <span className="text-sm font-medium text-slate-500">{period.temperatureUnit}</span>
                          </div>
                        </div>
                        <div className="p-2 bg-blue-50 rounded-lg group-hover:scale-110 transition-transform">
                          {getWeatherIcon(period.shortForecast, period.isDaytime)}
                        </div>
                      </div>
                      
                      <div className="space-y-3">
                        <p className="text-sm font-medium text-slate-700">{period.shortForecast}</p>
                        
                        <div className="flex items-center gap-4 text-xs text-slate-500">
                          {period.probabilityOfPrecipitation?.value > 0 && (
                            <div className="flex items-center gap-1" title="Probability of Precipitation">
                              <Droplets className="w-3.5 h-3.5 text-blue-400" />
                              {period.probabilityOfPrecipitation.value}%
                            </div>
                          )}
                          <div className="flex items-center gap-1" title="Wind">
                            <Wind className="w-3.5 h-3.5 text-slate-400" />
                            {period.windSpeed}
                          </div>
                        </div>

                        {/* Detailed Description Tooltip/Text */}
                        <p className="text-xs text-slate-500 leading-relaxed border-t border-slate-200 pt-3 mt-3">
                          {period.detailedForecast}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Hourly Forecast (Horizontal Scroll) */}
              {activeTab === 'hourly' && forecast?.hourly && (
                <div className="flex overflow-x-auto pb-6 pt-2 gap-4 snap-x hide-scrollbar">
                  {forecast.hourly.map((hour, index) => (
                    <div 
                      key={index} 
                      className="min-w-[120px] p-4 rounded-xl border border-slate-100 bg-slate-50 flex flex-col items-center text-center snap-center hover:bg-blue-50 transition-colors"
                    >
                      <span className="text-sm font-medium text-slate-500 mb-3">
                        {index === 0 ? 'Now' : formatTime(hour.startTime)}
                      </span>
                      
                      <div className="mb-3">
                        {getWeatherIcon(hour.shortForecast, hour.isDaytime)}
                      </div>
                      
                      <span className="text-xl font-bold text-slate-800 mb-1">
                        {hour.temperature}°
                      </span>
                      
                      <span className="text-xs text-slate-500 font-medium line-clamp-2 px-1">
                        {hour.shortForecast}
                      </span>

                      {hour.probabilityOfPrecipitation?.value > 0 && (
                        <div className="flex items-center gap-1 mt-2 text-xs text-blue-500 font-medium bg-blue-100 px-2 py-0.5 rounded-full">
                          <Droplets className="w-3 h-3" />
                          {hour.probabilityOfPrecipitation.value}%
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* CPC Seasonal Climate Forecast */}
              {activeTab === 'climate' && (
                <div className="space-y-6 animate-in fade-in duration-300">
                  {!cpcOutlooks ? (
                     <div className="text-center p-10 bg-slate-50 rounded-2xl border border-slate-100">
                       <BarChart3 className="w-10 h-10 text-slate-400 mx-auto mb-3" />
                       <h3 className="text-lg font-semibold text-slate-700">Outlooks Unavailable</h3>
                       <p className="text-slate-500 mt-2 max-w-md mx-auto">Official NOAA Climate Prediction Center seasonal outlooks are currently not available for this location or the service is temporarily offline.</p>
                     </div>
                  ) : (
                    <>
                      {/* Season Selector Carousel */}
                      <div className="flex overflow-x-auto pb-4 gap-3 snap-x hide-scrollbar">
                        {cpcOutlooks.map((outlook, index) => (
                          <button
                            key={index}
                            onClick={() => setSelectedClimateMonth(index)}
                            className={`shrink-0 min-w-fit px-4 py-3 rounded-xl border flex flex-col items-center text-center snap-center transition-all ${
                              selectedClimateMonth === index 
                                ? 'bg-indigo-600 border-indigo-600 text-white shadow-md' 
                                : 'bg-slate-50 border-slate-100 text-slate-600 hover:bg-indigo-50 hover:border-indigo-200'
                            }`}
                          >
                            <span className={`text-xs font-semibold mb-1 whitespace-nowrap ${selectedClimateMonth === index ? 'text-indigo-100' : 'text-slate-400'}`}>
                              {outlook.year}
                            </span>
                            <span className="text-base md:text-lg font-bold whitespace-nowrap tracking-tight">
                              {outlook.shortName}
                            </span>
                          </button>
                        ))}
                      </div>

                      {/* Selected Season Details */}
                      <div className="bg-slate-50 rounded-2xl p-6 md:p-8 border border-slate-100">
                        <div className="flex flex-col gap-6">
                          
                          <div className="flex items-center gap-3 border-b border-slate-200 pb-4">
                            <div className="p-3 bg-indigo-100 text-indigo-600 rounded-xl">
                              <CalendarDays className="w-6 h-6" />
                            </div>
                            <div>
                              <h3 className="text-2xl font-bold text-slate-800">
                                {cpcOutlooks[selectedClimateMonth].title}
                              </h3>
                              <p className="text-sm text-slate-500 font-medium">3-Month Seasonal Outlook</p>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
                            {/* Temperature Outlook */}
                            <div className={`p-6 rounded-xl border shadow-sm flex flex-col ${getCatColor(cpcOutlooks[selectedClimateMonth].temp.cat, 'temp')}`}>
                              <div className="flex items-center gap-2 font-semibold mb-3">
                                <Thermometer className="w-5 h-5" /> Temperature
                              </div>
                              <span className="text-3xl font-bold mb-1 tracking-tight">{cpcOutlooks[selectedClimateMonth].temp.cat}</span>
                              {cpcOutlooks[selectedClimateMonth].temp.prob && (
                                <span className="text-sm font-medium opacity-80 mb-4 bg-white/40 px-2 py-1 rounded w-fit">{cpcOutlooks[selectedClimateMonth].temp.prob}% Probability</span>
                              )}
                              <p className="text-sm mt-auto font-medium leading-relaxed">{cpcOutlooks[selectedClimateMonth].temp.description}</p>
                            </div>
                            
                            {/* Precipitation Outlook */}
                            <div className={`p-6 rounded-xl border shadow-sm flex flex-col ${getCatColor(cpcOutlooks[selectedClimateMonth].precip.cat, 'precip')}`}>
                              <div className="flex items-center gap-2 font-semibold mb-3">
                                <Droplets className="w-5 h-5" /> Precipitation
                              </div>
                              <span className="text-3xl font-bold mb-1 tracking-tight">{cpcOutlooks[selectedClimateMonth].precip.cat}</span>
                              {cpcOutlooks[selectedClimateMonth].precip.prob && (
                                <span className="text-sm font-medium opacity-80 mb-4 bg-white/40 px-2 py-1 rounded w-fit">{cpcOutlooks[selectedClimateMonth].precip.prob}% Probability</span>
                              )}
                              <p className="text-sm mt-auto font-medium leading-relaxed">{cpcOutlooks[selectedClimateMonth].precip.description}</p>
                            </div>
                          </div>
                          
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-3 text-xs text-indigo-700 bg-indigo-50/50 p-4 rounded-xl border border-indigo-100">
                         <BarChart3 className="w-5 h-5 shrink-0" />
                         <p>Data provided directly by the <strong>NOAA Climate Prediction Center (CPC)</strong>. These outlooks indicate the probability of 3-month seasonal averages being Above, Near, or Below historical norms. "Equal Chances" indicates no strong climate signal pointing in either direction for the given period.</p>
                      </div>
                    </>
                  )}
                </div>
              )}

            </div>
            )}
            
            {!loading && (
            <p className="text-xs text-center text-slate-400 pt-4">
              Data provided by the National Weather Service (weather.gov) API
            </p>
            )}
          </div>
        )}

        {/* View Routing - Education Guide */}
        {mainTab === 'education' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            
            {/* Education Hero */}
            <div className="bg-gradient-to-br from-emerald-700 to-teal-900 rounded-3xl p-8 md:p-10 text-white shadow-xl relative overflow-hidden">
               <div className="absolute -top-24 -right-24 w-64 h-64 bg-white opacity-10 rounded-full blur-3xl pointer-events-none"></div>
               <div className="relative z-10 max-w-2xl">
                 <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">Understanding California Weather</h2>
                 <p className="text-teal-100 text-lg">California's unique geography creates some of the most fascinating and complex weather patterns in the world. Explore the mechanics behind our climate.</p>
               </div>
            </div>

            {/* Educational Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              
              {/* Marine Layer */}
              <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
                <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center mb-5">
                  <Waves className="w-6 h-6" />
                </div>
                <h3 className="text-xl font-bold text-slate-800 mb-3">The Marine Layer</h3>
                <h4 className="text-sm font-semibold text-blue-600 mb-2">"May Gray" & "June Gloom"</h4>
                <p className="text-slate-600 leading-relaxed text-sm">
                  A marine layer is an air mass that develops over the surface of a large body of water in the presence of a temperature inversion. In California, cold Pacific currents chill the air directly above the ocean. Meanwhile, high pressure systems aloft push down, compressing and warming the air higher up. This traps the cool, moist air near the surface, creating low clouds and fog along the coast that typically burns off by the afternoon.
                </p>
              </div>

              {/* Santa Ana Winds */}
              <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
                <div className="w-12 h-12 bg-red-100 text-red-600 rounded-xl flex items-center justify-center mb-5">
                  <Flame className="w-6 h-6" />
                </div>
                <h3 className="text-xl font-bold text-slate-800 mb-3">Santa Ana Winds</h3>
                <h4 className="text-sm font-semibold text-red-600 mb-2">Extreme Fire Weather</h4>
                <p className="text-slate-600 leading-relaxed text-sm">
                  Santa Ana winds are strong, extremely dry downslope winds that originate inland in desert regions like the Great Basin. As high pressure forces this air over and down the Southern California mountain ranges, it compresses. This compression drastically heats the air and strips away humidity (often dropping below 10%). Occurring primarily in fall and winter, these winds create critical fire danger across the region.
                </p>
              </div>

              {/* Microclimates */}
              <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
                <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-xl flex items-center justify-center mb-5">
                  <Map className="w-6 h-6" />
                </div>
                <h3 className="text-xl font-bold text-slate-800 mb-3">Complex Microclimates</h3>
                <h4 className="text-sm font-semibold text-emerald-600 mb-2">Coast, Valley, Mountain, Desert</h4>
                <p className="text-slate-600 leading-relaxed text-sm">
                  Because California features massive mountain ranges immediately adjacent to a cold ocean, the state is famous for its microclimates. Weather conditions can change drastically over just a few miles. During the summer, it is incredibly common for coastal cities to experience mild 70°F (21°C) temperatures while inland valleys just 20 miles east bake in 100°F (38°C) heat due to the mountains blocking the cool marine air.
                </p>
              </div>

              {/* El Nino 2026 */}
              <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
                <div className="w-12 h-12 bg-indigo-100 text-indigo-600 rounded-xl flex items-center justify-center mb-5">
                  <Globe className="w-6 h-6" />
                </div>
                <h3 className="text-xl font-bold text-slate-800 mb-3">El Niño & ENSO</h3>
                <h4 className="text-sm font-semibold text-indigo-600 mb-2">Current 2026-2027 Outlook</h4>
                <p className="text-slate-600 leading-relaxed text-sm">
                  The El Niño-Southern Oscillation (ENSO) cycle dictates Pacific Ocean temperatures and heavily influences California winters. According to the latest NOAA updates in August 2026, an <strong>El Niño Advisory</strong> is in effect. Forecasters predict a greater than 90% chance of a "very strong" event during the fall and winter of 2026-27. There is a 69% chance this could become a historic event exceeding the strength of previous records dating back to 1950, which historically increases the likelihood of a very wet winter in Southern California.
                </p>
              </div>

            </div>
          </div>
        )}

      </div>
      
      {/* Add some custom styles for hiding scrollbar but keeping functionality */}
      <style>{`
        .hide-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .hide-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </div>
  );
};

export default WeatherApp;
