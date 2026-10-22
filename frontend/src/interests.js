// Reader-facing choices, kept separate from the current RSS category filters.
export const TOPICS = {
  Business: { label: 'Industries', options: ['Finance & banking', 'Technology', 'Healthcare', 'Energy', 'Real estate', 'Retail & consumer goods', 'Automotive', 'Media & entertainment'] },
  Sports: { label: 'Sports', options: ['Basketball', 'Soccer', 'American football', 'Baseball', 'Ice hockey', 'Tennis', 'Motorsport', 'Golf'] },
  Tech: { label: 'Technology topics', options: ['Artificial intelligence', 'Cybersecurity', 'Consumer technology', 'Software & development', 'Startups', 'Gaming', 'Space technology'] },
  World: { label: 'Regions & topics', options: ['North America', 'Latin America', 'Europe', 'Asia', 'Africa', 'Middle East', 'Oceania', 'International relations'] },
  Science: { label: 'Science topics', options: ['Space & astronomy', 'Climate & environment', 'Medicine & health', 'Biology', 'Physics', 'Earth science'] },
}

// A short starting list; readers can add any team that is missing.
export const TEAMS = {
  Basketball: ['Toronto Raptors', 'Los Angeles Lakers', 'Boston Celtics', 'Golden State Warriors'],
  Soccer: ['Toronto FC', 'Liverpool', 'Manchester United', 'Real Madrid', 'FC Barcelona'],
  'American football': ['Buffalo Bills', 'Kansas City Chiefs', 'Dallas Cowboys', 'San Francisco 49ers'],
  Baseball: ['Toronto Blue Jays', 'New York Yankees', 'Los Angeles Dodgers', 'Boston Red Sox'],
  'Ice hockey': ['Toronto Maple Leafs', 'Montreal Canadiens', 'Edmonton Oilers', 'Vancouver Canucks'],
  Motorsport: ['Ferrari', 'McLaren', 'Mercedes', 'Red Bull Racing'],
}
