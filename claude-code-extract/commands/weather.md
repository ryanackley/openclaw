# Weather

Get current weather and forecasts via wttr.in. No API key needed.

## Usage

When asked about weather, temperature, or forecasts for any location:

```bash
# One-line summary
curl "wttr.in/London?format=3"

# Detailed current conditions
curl "wttr.in/London?0"

# 3-day forecast
curl "wttr.in/London"

# Quick answer: "What's the weather?"
curl -s "wttr.in/London?format=%l:+%c+%t+(feels+like+%f),+%w+wind,+%h+humidity"

# Will it rain?
curl -s "wttr.in/London?format=%l:+%c+%p"

# JSON output for programmatic use
curl "wttr.in/London?format=j1"
```

Always include a city, region, or airport code. Supports airport codes like `ORD`, `LAX`.

Format codes: `%c` condition, `%t` temp, `%f` feels-like, `%w` wind, `%h` humidity, `%p` precipitation, `%l` location.
