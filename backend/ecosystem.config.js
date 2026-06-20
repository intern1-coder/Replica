module.exports = {
  apps: [
    {
      name: 'affinity-backend',
      script: 'dist/server.js',
      instances: 'max',       // Run across all available CPU cores
      exec_mode: 'cluster',   // Cluster mode for load balancing
      autorestart: true,      // Automatically restart on crash
      watch: false,           // Disable watch in production
      max_memory_restart: '1G', // Restart if it uses more than 1GB memory
      env: {
        NODE_ENV: 'production'
      },
      log_date_format: 'YYYY-MM-DD HH:mm Z',
      error_file: 'logs/err.log',
      out_file: 'logs/out.log',
      merge_logs: true
    }
  ]
};
