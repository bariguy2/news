import '@testing-library/jest-dom/vitest'

// JSDOM has no scrolling layout; browser E2E verifies the real scroll behavior.
window.scrollTo = () => {}
