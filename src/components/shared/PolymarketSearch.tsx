import { useState, useCallback, useRef } from 'react';
import {
  Box,
  TextField,
  Button,
  ToggleButton,
  ToggleButtonGroup,
  Autocomplete,
  Typography,
  CircularProgress,
  Alert,
  Tooltip,
  IconButton,
} from '@mui/material';
import OpenInNew from '@mui/icons-material/OpenInNew';
import type { PolymarketEvent, ParsedMarket, CryptoOption, OptionType } from '../../types';
import {
  searchEvents,
  fetchEventBySlug,
  parseMarkets,
  detectCrypto,
  detectOptionType,
  extractSlugFromUrl,
  isValidPolymarketUrl,
  type EventSearchResult,
} from '../../api/polymarket';

interface PolymarketSearchProps {
  onEventLoaded: (event: PolymarketEvent, markets: ParsedMarket[], crypto: CryptoOption | null, optionType: OptionType) => void;
  loading?: boolean;
  eventSlug?: string;
}

export function PolymarketSearch({ onEventLoaded, loading: externalLoading, eventSlug }: PolymarketSearchProps) {
  const [mode, setMode] = useState<'url' | 'search'>('url');
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<EventSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadEventBySlug = useCallback(async (slug: string) => {
    setLoading(true);
    setError(null);
    try {
      const event = await fetchEventBySlug(slug);
      const markets = parseMarkets(event.markets);
      const crypto = detectCrypto(event);
      const optionType = detectOptionType(event);
      onEventLoaded(event, markets, crypto, optionType);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load event');
    } finally {
      setLoading(false);
    }
  }, [onEventLoaded]);

  const handleUrlLoad = useCallback(() => {
    const slug = extractSlugFromUrl(url.trim());
    if (!slug) {
      setError('Invalid Polymarket URL');
      return;
    }
    loadEventBySlug(slug);
  }, [url, loadEventBySlug]);

  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!value.trim()) {
      setSearchResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const results = await searchEvents(value);
        setSearchResults(results);
      } catch {
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 300);
  }, []);

  const handleSearchSelect = useCallback((_: React.SyntheticEvent, value: EventSearchResult | null) => {
    if (!value) return;
    loadEventBySlug(value.slug);
  }, [loadEventBySlug]);

  const isLoading = loading || externalLoading;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <ToggleButtonGroup
          value={mode}
          exclusive
          onChange={(_, v) => v && setMode(v)}
          size="small"
        >
          <ToggleButton value="url">URL</ToggleButton>
          <ToggleButton value="search">Search</ToggleButton>
        </ToggleButtonGroup>
        {eventSlug && (
          <Tooltip title="Open on Polymarket">
            <IconButton
              size="small"
              component="a"
              href={`https://polymarket.com/event/${eventSlug}?r=shtanga`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <OpenInNew fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Box>

      {mode === 'url' ? (
        <Box sx={{ display: 'flex', gap: 1 }}>
          <TextField
            size="small"
            fullWidth
            placeholder="https://polymarket.com/event/..."
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && isValidPolymarketUrl(url) && handleUrlLoad()}
            disabled={isLoading}
          />
          <Button
            variant="contained"
            size="small"
            onClick={handleUrlLoad}
            disabled={isLoading || !isValidPolymarketUrl(url)}
            sx={{ whiteSpace: 'nowrap' }}
          >
            {isLoading ? <CircularProgress size={16} /> : 'Load'}
          </Button>
        </Box>
      ) : (
        <Autocomplete<EventSearchResult>
          size="small"
          options={searchResults}
          getOptionLabel={o => o.title}
          loading={searchLoading}
          inputValue={searchQuery}
          onInputChange={(_, v) => handleSearchChange(v)}
          onChange={handleSearchSelect}
          filterOptions={x => x}
          renderOption={(props, option) => (
            <li {...props} key={option.id}>
              <Box>
                <Typography variant="body2">{option.title}</Typography>
                <Typography variant="caption" color="text.secondary">
                  Expires: {new Date(option.endDate * 1000).toLocaleDateString()}
                </Typography>
              </Box>
            </li>
          )}
          renderInput={(params) => (
            <TextField
              {...params}
              placeholder="Search events..."
              InputProps={{
                ...params.InputProps,
                endAdornment: (
                  <>
                    {searchLoading && <CircularProgress size={16} />}
                    {params.InputProps.endAdornment}
                  </>
                ),
              }}
            />
          )}
        />
      )}

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
    </Box>
  );
}
