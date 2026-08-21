export const Logger = {
  info: (msg: string, ...args: any[]) => console.log(`[${new Date().toISOString()}] ℹ️  ${msg}`, ...args),
  success: (msg: string, ...args: any[]) => console.log(`[${new Date().toISOString()}] ✅ ${msg}`, ...args),
  warn: (msg: string, ...args: any[]) => console.warn(`[${new Date().toISOString()}] ⚠️  ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[${new Date().toISOString()}] ❌ ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[${new Date().toISOString()}] 🔍 ${msg}`, ...args);
    }
  },
};
