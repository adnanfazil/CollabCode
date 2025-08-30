// Simple script to clear localStorage for testing
if (typeof window !== 'undefined') {
  localStorage.removeItem('authToken');
  console.log('Cleared authToken from localStorage');
} else {
  console.log('This script should be run in the browser console');
  console.log('Run: localStorage.removeItem("authToken")');
}