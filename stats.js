/**
 * BLE Scanner Statistics Application
 * 
 * This application analyses the data collected by the BLE scanner and provides
 * statistical information about detected devices, including signal strength,
 * detection patterns, and device characteristics.
 * 
 * Features:
 * - Total scan count and unique device statistics
 * - Time range analysis
 * - Signal strength (RSSI) statistics
 * - Busiest hours analysis
 * - Device history tracking
 * - Manufacturer data analysis
 * - Service UUID analysis
 * - Device consistency tracking
 * - Transmission power level analysis
 * 
 * Dependencies:
 * - sqlite3: Database access
 * - path: File path resolution
 * 
 * Created: 2025
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'ble_scans.db');
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
  if (err) {
    console.error(`Error opening database: ${err.message}`);
    console.error(`Make sure the database file exists at: ${dbPath}`);
    console.error('Run the scanner script first to create and populate the database.');
    process.exit(1); // Exit if DB can't be opened
  } else {
    console.log(`Connected to the SQLite database at ${dbPath}`);
    runQueries();
  }
});

function runQueries() {
  console.log('\n--- Database Statistics ---');

  // Use db.serialize to ensure queries run in order
  db.serialize(() => {
    // 1. Get Total Scan Count
    db.get('SELECT COUNT(*) as total_scans FROM scans', [], (err, row) => {
      if (err) {
        return console.error('Error getting total scan count:', err.message);
      }
      console.log(`Total scan records logged: ${row.total_scans}`);
    });

    // 2. Get Unique Device Count
    db.get('SELECT COUNT(DISTINCT address) as unique_devices FROM scans', [], (err, row) => {
      if (err) {
        return console.error('Error getting unique device count:', err.message);
      }
      console.log(`Unique devices detected: ${row.unique_devices}`);
    });

    // 3. Get Time Range
    db.get('SELECT MIN(timestamp) as first_scan, MAX(timestamp) as last_scan FROM scans', [], (err, row) => {
      if (err) {
        return console.error('Error getting time range:', err.message);
      }
      if (row.first_scan && row.last_scan) {
        console.log(`Data ranges from: ${new Date(row.first_scan).toLocaleString('en-GB')} to ${new Date(row.last_scan).toLocaleString('en-GB')}`);
      } else {
        console.log('No scan data found to determine time range.');
      }
    });

    // 4. RSSI Statistics
    db.all('SELECT address, AVG(rssi) as avg_rssi, MIN(rssi) as min_rssi, MAX(rssi) as max_rssi FROM scans GROUP BY address ORDER BY avg_rssi DESC', [], (err, rows) => {
      if (err) {
        return console.error('Error getting RSSI statistics:', err.message);
      }
      console.log('\n--- Signal Strength Statistics ---');
      if (rows.length > 0) {
        rows.forEach(row => {
          console.log(`${row.address}: Avg: ${row.avg_rssi.toFixed(1)} dBm, Range: ${row.min_rssi} to ${row.max_rssi} dBm`);
        });
      } else {
        console.log('No RSSI data available.');
      }
    });

    // 5. Time Analysis (Hour of day frequency)
    db.all("SELECT strftime('%H', timestamp) as hour, COUNT(*) as count FROM scans GROUP BY hour ORDER BY count DESC", [], (err, rows) => {
      if (err) {
        return console.error('Error getting hourly statistics:', err.message);
      }
      console.log('\n--- Busiest Hours ---');
      if (rows.length > 0) {
        rows.forEach(row => {
          console.log(`${row.hour}:00 - ${row.hour}:59: ${row.count} readings`);
        });
      } else {
        console.log('No hourly data available.');
      }
    });

    // 6. First/Last Seen
    db.all('SELECT address, MIN(timestamp) as first_seen, MAX(timestamp) as last_seen, COUNT(*) as reading_count FROM scans GROUP BY address ORDER BY first_seen', [], (err, rows) => {
      if (err) {
        return console.error('Error getting device history:', err.message);
      }
      console.log('\n--- Device History ---');
      if (rows.length > 0) {
        rows.forEach(row => {
          const firstDate = new Date(row.first_seen).toLocaleString('en-GB');
          const lastDate = new Date(row.last_seen).toLocaleString('en-GB');
          console.log(`${row.address}: First seen: ${firstDate}, Last seen: ${lastDate}, Total readings: ${row.reading_count}`);
        });
      } else {
        console.log('No device history available.');
      }
    });

    // 7. Manufacturer data analysis
    db.all('SELECT DISTINCT manufacturer_data, COUNT(DISTINCT address) as device_count FROM scans WHERE manufacturer_data IS NOT NULL GROUP BY manufacturer_data ORDER BY device_count DESC LIMIT 10', [], (err, rows) => {
      if (err) {
        return console.error('Error getting manufacturer data:', err.message);
      }
      console.log('\n--- Top Manufacturer Data Patterns ---');
      if (rows.length > 0) {
        rows.forEach(row => {
          console.log(`Pattern: ${row.manufacturer_data}: ${row.device_count} devices`);
        });
      } else {
        console.log('No manufacturer data available.');
      }
    });

    // 8. UUID analysis
    db.all("SELECT DISTINCT service_uuids, COUNT(DISTINCT address) as device_count FROM scans WHERE service_uuids <> '' GROUP BY service_uuids ORDER BY device_count DESC LIMIT 10", [], (err, rows) => {
      if (err) {
        return console.error('Error getting service UUIDs:', err.message);
      }
      console.log('\n--- Most Common Service UUIDs ---');
      if (rows.length > 0) {
        rows.forEach(row => {
          console.log(`Services: ${row.service_uuids}: ${row.device_count} devices`);
        });
      } else {
        console.log('No service UUID data available.');
      }
    });

    // 9. Device consistency (appearances over time)
    db.all('SELECT address, COUNT(DISTINCT date(timestamp)) as days_present FROM scans GROUP BY address ORDER BY days_present DESC', [], (err, rows) => {
      if (err) {
        return console.error('Error getting device consistency:', err.message);
      }
      console.log('\n--- Device Consistency ---');
      if (rows.length > 0) {
        rows.forEach(row => {
          console.log(`${row.address}: Detected on ${row.days_present} different days`);
        });
      } else {
        console.log('No device consistency data available.');
      }
    });

    // 10. Transmission Power Level Analysis
    db.all('SELECT address, tx_power_level, COUNT(*) as count FROM scans WHERE tx_power_level IS NOT NULL GROUP BY address, tx_power_level ORDER BY count DESC', [], (err, rows) => {
      if (err) {
        return console.error('Error getting transmission power levels:', err.message);
      }
      console.log('\n--- Transmission Power Levels ---');
      if (rows.length > 0) {
        // Group by address first
        const devicePowerLevels = {};
        rows.forEach(row => {
          if (!devicePowerLevels[row.address]) {
            devicePowerLevels[row.address] = [];
          }
          devicePowerLevels[row.address].push({
            power: row.tx_power_level,
            count: row.count
          });
        });
        
        // Display grouped results
        Object.keys(devicePowerLevels).forEach(address => {
          console.log(`${address}:`);
          devicePowerLevels[address].forEach(item => {
            console.log(`  Power Level: ${item.power} dBm (${item.count} readings)`);
          });
        });
      } else {
        console.log('No transmission power level data available.');
      }
    });

    // 11. Local Name Analysis
    db.all('SELECT local_name, COUNT(DISTINCT address) as device_count FROM scans WHERE local_name IS NOT NULL AND local_name != "N/A" GROUP BY local_name ORDER BY device_count DESC LIMIT 10', [], (err, rows) => {
      if (err) {
        return console.error('Error getting local names:', err.message);
      }
      console.log('\n--- Most Common Device Names ---');
      if (rows.length > 0) {
        rows.forEach(row => {
          console.log(`Name: ${row.local_name}: ${row.device_count} devices`);
        });
      } else {
        console.log('No local name data available.');
      }
      
      // Close the database connection after all queries are done
      closeDatabase();
    });
  });
}

function closeDatabase() {
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err.message);
    } else {
      console.log('Database connection closed.');
    }
  });
}

// Handle potential script interruption to close DB
process.on('SIGINT', () => {
    console.log("\nClosing database due to interrupt...");
    closeDatabase();
    process.exit(0);
}); 