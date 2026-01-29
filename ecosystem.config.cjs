/**
 * PM2 Ecosystem Configuration
 * 
 * Usage:
 *   Development: pm2 start ecosystem.config.cjs --env development
 *   Production:  pm2 start ecosystem.config.cjs --env production
 *   
 * Commands:
 *   pm2 status         - View process status
 *   pm2 logs           - View logs
 *   pm2 restart all    - Restart all processes
 *   pm2 stop all       - Stop all processes
 *   pm2 delete all     - Remove all processes
 *   pm2 monit          - Monitor dashboard
 */

module.exports = {
  apps: [
    {
      name: 'vendor-tracker-api',
      script: 'dist/index.js',
      cwd: './server',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      
      // Restart configuration
      exp_backoff_restart_delay: 100, // Exponential backoff on restart
      max_restarts: 10,               // Max restarts within min_uptime window
      min_uptime: '10s',              // Minimum uptime before considered stable
      restart_delay: 1000,            // Delay between restarts
      
      // Logging
      error_file: './logs/api-error.log',
      out_file: './logs/api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      
      // Graceful shutdown
      kill_timeout: 5000,             // Time to wait before SIGKILL
      listen_timeout: 8000,           // Time to wait for app to listen
      shutdown_with_message: true,
      
      // Environment variables
      env: {
        NODE_ENV: 'development',
        PORT: 3001,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
    },
    {
      name: 'vendor-tracker-client',
      script: 'npx',
      args: 'vite preview --port 5173 --host',
      cwd: './client',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      
      // Restart configuration  
      exp_backoff_restart_delay: 100,
      max_restarts: 10,
      min_uptime: '5s',
      restart_delay: 1000,
      
      // Logging
      error_file: './logs/client-error.log',
      out_file: './logs/client-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      
      // Graceful shutdown
      kill_timeout: 3000,
      
      // Environment
      env: {
        NODE_ENV: 'production',
      },
      env_production: {
        NODE_ENV: 'production',
      },
    },
  ],
};
