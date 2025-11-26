import { useState, useEffect, useRef } from "react";

export default function SearchBar({ onLocationSelect, globeRef }) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [error, setError] = useState("");
  const searchTimeoutRef = useRef(null);
  const dropdownRef = useRef(null);

  // Search for suggestions as user types
  const searchSuggestions = async (searchQuery) => {
    if (!searchQuery.trim() || searchQuery.length < 2) {
      setSuggestions([]);
      setShowDropdown(false);
      setError("");
      return;
    }
    
    setIsSearching(true);
    setError("");

    try {
      // Use AbortController to cancel previous requests
      const controller = new AbortController();
      
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(searchQuery)}&addressdetails=1&countrycodes=us,ca&bounded=0&dedupe=1&extratags=1`,
        { 
          signal: controller.signal,
          headers: {
            'User-Agent': 'FireCastX-App'
          }
        }
      );
      
      if (!response.ok) {
        throw new Error('Search service unavailable');
      }
      
      const data = await response.json();
      
      if (data && data.length > 0) {
        const formattedSuggestions = data.map((item, index) => ({
          id: index,
          name: item.display_name,
          lat: parseFloat(item.lat),
          lon: parseFloat(item.lon),
          type: item.type || 'location',
          importance: item.importance || 0
        })).sort((a, b) => b.importance - a.importance); // Sort by relevance
        
        setSuggestions(formattedSuggestions);
        setShowDropdown(true);
        setError("");
      } else {
        // Try a broader search if no exact matches found
        const broaderQuery = searchQuery.length >= 4 ? searchQuery.substring(0, Math.ceil(searchQuery.length * 0.7)) + '*' : searchQuery + '*';
        
        const broaderResponse = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&limit=3&q=${encodeURIComponent(broaderQuery)}&addressdetails=1&countrycodes=us,ca&bounded=0`,
          { 
            signal: controller.signal,
            headers: {
              'User-Agent': 'FireCastX-App'
            }
          }
        );
        
        if (broaderResponse.ok) {
          const broaderData = await broaderResponse.json();
          if (broaderData && broaderData.length > 0) {
            const formattedSuggestions = broaderData.map((item, index) => ({
              id: index,
              name: item.display_name,
              lat: parseFloat(item.lat),
              lon: parseFloat(item.lon),
              type: item.type || 'location',
              importance: item.importance || 0
            })).sort((a, b) => b.importance - a.importance);
            
            setSuggestions(formattedSuggestions);
            setShowDropdown(true);
            setError("");
          } else {
            setSuggestions([]);
            setShowDropdown(false);
            setError("No matches found");
          }
        } else {
          setSuggestions([]);
          setShowDropdown(false);
          setError("No matches found");
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Search error:', err);
        setError("Search failed. Please try again.");
        setSuggestions([]);
        setShowDropdown(false);
      }
    } finally {
      setIsSearching(false);
    }
  };

  // Handle input change with debounced search
  const handleInputChange = (e) => {
    const value = e.target.value;
    setQuery(value);
    
    // Clear previous timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    
    // Set new timeout for search
    searchTimeoutRef.current = setTimeout(() => {
      searchSuggestions(value);
    }, 400); // 400ms debounce for better responsiveness
  };

  // Handle suggestion selection
  const handleSuggestionClick = (suggestion) => {
    setQuery(suggestion.name);
    setShowDropdown(false);
    setSuggestions([]);
    
    // Navigate to location
    navigateToLocation(suggestion);
  };

  // Navigate to the selected location
  const navigateToLocation = (location) => {
    console.log('Navigating to:', location);
    
    // Use requestAnimationFrame to prevent UI blocking
    requestAnimationFrame(() => {
      try {
        const globe = globeRef.current;
        
        if (globe) {
          // Optimized navigation with shorter duration
          const navParams = {
            lon: location.lon,
            lat: location.lat,
            height: 800000, // Slightly lower for faster navigation
            duration: 1200   // Faster animation
          };
          
          // Method 1: Direct flyTo
          if (globe.flyTo) {
            globe.flyTo(navParams);
          }
          // Method 2: Via getGlobus
          else if (globe.getGlobus && globe.getGlobus()) {
            const globus = globe.getGlobus();
            if (globus.planet && globus.planet.camera) {
              globus.planet.flyLonLat(navParams);
            }
          }
          // Method 3: Direct camera control
          else if (globe.camera) {
            globe.camera.flyTo(navParams);
          }
          
          console.log('Navigation completed for:', location.name);
        } else {
          console.warn('Globe reference not available');
        }
        
        // Call callback
        if (onLocationSelect) {
          onLocationSelect(location);
        }
        
      } catch (err) {
        console.error('Navigation error:', err);
        setError("Could not navigate to location.");
      }
    });
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div className="search-bar-container" ref={dropdownRef}>
      <div className="search-form">
        <div className="search-input-wrapper">
          <input
            type="text"
            value={query}
            onChange={handleInputChange}
            placeholder="Search cities, states, countries..."
            className="search-input"
            autoComplete="off"
          />
          <div className="search-status">
            {isSearching ? "🔍" : "📍"}
          </div>
        </div>
        
        {/* Dropdown with suggestions */}
        {showDropdown && suggestions.length > 0 && (
          <div className="search-dropdown">
            {suggestions.map((suggestion) => (
              <div
                key={suggestion.id}
                className="search-suggestion"
                onClick={() => handleSuggestionClick(suggestion)}
              >
                <div className="suggestion-icon">📍</div>
                <div className="suggestion-text">
                  <div className="suggestion-name">
                    {suggestion.name.split(',')[0]} {/* Show main location name */}
                  </div>
                  <div className="suggestion-details">
                    {suggestion.name.split(',').slice(1, 3).join(',').trim()} {/* Show additional details */}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        
        {error && (
          <div className="search-error">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}