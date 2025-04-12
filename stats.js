/**
 * BLE Scanner Application - Statistics Reporter
 * 
 * This utility analyses the data collected by the BLE scanner and provides
 * a report of statistical information about devices detected, including signal
 * strength, detection patterns, and device characteristics.
 * 
 * The statistics are based on device 'fingerprints' rather than MAC addresses,
 * providing more reliable tracking of unique devices even when they use
 * random or changing addresses for privacy.
 * 
 * Features:
 * - Total scan count and unique device statistics (by fingerprint)
 * - Time range analysis
 * - Signal strength (RSSI) statistics per device fingerprint
 * - Busiest hours analysis
 * - Device history tracking using fingerprints
 * - Manufacturer data analysis
 * - Service UUID analysis
 * - Device consistency tracking across scan windows
 * - Transmission power level analysis
 * - Device fingerprint analysis
 * - Scan window statistics (10s every minute)
 * 
 * Dependencies:
 * - sqlite3: Database access
 * - path: File path resolution
 * 
 * Created: 12/Apr/2025
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Database connection setup
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

/**
 * Executes a series of SQL queries to analyse the BLE scan data
 * All statistics are now based on device fingerprints rather than MAC addresses
 * to provide more reliable tracking of unique devices
 */
function runQueries() {
  console.log('\n--- Database Statistics ---');

  // Use db.serialize to ensure queries run in order
  db.serialize(() => {
    // 1. Get Total Scan Count
    // This counts all scan records, including multiple readings of the same device
    db.get('SELECT COUNT(*) as total_scans FROM scans', [], (err, row) => {
      if (err) {
        return console.error('Error getting total scan count:', err.message);
      }
      console.log(`Total scan records logged: ${row.total_scans}`);
    });

    // 2. Get Unique Device Count
    // Uses fingerprint to count unique devices, accounting for random MAC addresses
    db.get('SELECT COUNT(DISTINCT fingerprint) as unique_devices FROM scans', [], (err, row) => {
      if (err) {
        return console.error('Error getting unique device count:', err.message);
      }
      console.log(`Unique devices detected (by fingerprint): ${row.unique_devices}`);
    });

    // 3. Get Ignored Device Count
    // Counts how many times devices in the ignore list were detected and skipped
    const ignoreListPath = path.resolve(__dirname, 'ignore_list.json');
    let ignoredAddresses = [];
    try {
      if (fs.existsSync(ignoreListPath)) {
        const ignoreListData = fs.readFileSync(ignoreListPath);
        ignoredAddresses = JSON.parse(ignoreListData);
        if (Array.isArray(ignoredAddresses)) {
          // Normalise addresses to lowercase for consistent matching
          ignoredAddresses = ignoredAddresses.map(addr => addr.toLowerCase());
        }
      }
    } catch (err) {
      console.error('Error reading ignore list:', err.message);
    }

    if (ignoredAddresses.length > 0) {
      const placeholders = ignoredAddresses.map(() => '?').join(',');
      db.get(`SELECT COUNT(*) as ignored_count FROM scans WHERE LOWER(address) IN (${placeholders})`, ignoredAddresses, (err, row) => {
        if (err) {
          return console.error('Error getting ignored device count:', err.message);
        }
        console.log(`Devices from ignore list detected and skipped: ${row.ignored_count}`);
      });
    } else {
      console.log('Devices from ignore list detected and skipped: 0 (no devices in ignore list)');
    }

    // 4. Get Time Range
    // Shows the full time period covered by the scan data
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

    // 5. RSSI Statistics
    // Groups signal strength data by device fingerprint for more accurate tracking
    db.all('SELECT fingerprint, AVG(rssi) as avg_rssi, MIN(rssi) as min_rssi, MAX(rssi) as max_rssi FROM scans GROUP BY fingerprint ORDER BY avg_rssi DESC', [], (err, rows) => {
      if (err) {
        return console.error('Error getting RSSI statistics:', err.message);
      }
      console.log('\n--- Signal Strength Statistics (by Device Fingerprint) ---');
      if (rows.length > 0) {
        rows.forEach(row => {
          console.log(`Fingerprint: ${row.fingerprint}: Avg: ${row.avg_rssi.toFixed(1)} dBm, Range: ${row.min_rssi} to ${row.max_rssi} dBm`);
        });
      } else {
        console.log('No RSSI data available.');
      }
    });

    // 6. Time Analysis
    // Shows when the most devices are detected, useful for understanding usage patterns
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

    // 7. First/Last Seen
    // Tracks device presence using fingerprints to handle random addresses
    db.all('SELECT fingerprint, MIN(timestamp) as first_seen, MAX(timestamp) as last_seen, COUNT(*) as reading_count FROM scans GROUP BY fingerprint ORDER BY first_seen', [], (err, rows) => {
      if (err) {
        return console.error('Error getting device history:', err.message);
      }
      console.log('\n--- Device History (by Fingerprint) ---');
      if (rows.length > 0) {
        rows.forEach(row => {
          const firstDate = new Date(row.first_seen).toLocaleString('en-GB');
          const lastDate = new Date(row.last_seen).toLocaleString('en-GB');
          console.log(`Fingerprint: ${row.fingerprint}: First seen: ${firstDate}, Last seen: ${lastDate}, Total readings: ${row.reading_count}`);
        });
      } else {
        console.log('No device history available.');
      }
    });

    // 8. Manufacturer Data Analysis
    // Identifies common manufacturer data patterns across devices
    db.all('SELECT DISTINCT manufacturer_data, COUNT(DISTINCT fingerprint) as device_count FROM scans WHERE manufacturer_data IS NOT NULL GROUP BY manufacturer_data ORDER BY device_count DESC LIMIT 10', [], (err, rows) => {
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

    // 9. UUID Analysis
    // Shows most common service UUIDs across devices
    db.all("SELECT DISTINCT service_uuids, COUNT(DISTINCT fingerprint) as device_count FROM scans WHERE service_uuids <> '' GROUP BY service_uuids ORDER BY device_count DESC LIMIT 10", [], (err, rows) => {
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

    // 10. Device Consistency
    // Tracks how consistently devices appear across different days
    db.all('SELECT fingerprint, COUNT(DISTINCT date(timestamp)) as days_present FROM scans GROUP BY fingerprint ORDER BY days_present DESC', [], (err, rows) => {
      if (err) {
        return console.error('Error getting device consistency:', err.message);
      }
      console.log('\n--- Device Consistency (by Fingerprint) ---');
      if (rows.length > 0) {
        rows.forEach(row => {
          console.log(`Fingerprint: ${row.fingerprint}: Detected on ${row.days_present} different days`);
        });
      } else {
        console.log('No device consistency data available.');
      }
    });

    // 11. Transmission Power Level Analysis
    // Shows power level patterns for each device fingerprint
    db.all('SELECT fingerprint, tx_power_level, COUNT(*) as count FROM scans WHERE tx_power_level IS NOT NULL GROUP BY fingerprint, tx_power_level ORDER BY count DESC', [], (err, rows) => {
      if (err) {
        return console.error('Error getting transmission power levels:', err.message);
      }
      console.log('\n--- Transmission Power Levels (by Fingerprint) ---');
      if (rows.length > 0) {
        // Group by fingerprint first
        const devicePowerLevels = {};
        rows.forEach(row => {
          if (!devicePowerLevels[row.fingerprint]) {
            devicePowerLevels[row.fingerprint] = [];
          }
          devicePowerLevels[row.fingerprint].push({
            power: row.tx_power_level,
            count: row.count
          });
        });
        
        // Display grouped results
        Object.keys(devicePowerLevels).forEach(fingerprint => {
          console.log(`Fingerprint: ${fingerprint}:`);
          devicePowerLevels[fingerprint].forEach(item => {
            console.log(`  Power Level: ${item.power} dBm (${item.count} readings)`);
          });
        });
      } else {
        console.log('No transmission power level data available.');
      }
    });

    // 12. Local Name Analysis
    // Shows most common device names across fingerprints
    db.all('SELECT local_name, COUNT(DISTINCT fingerprint) as device_count FROM scans WHERE local_name IS NOT NULL AND local_name != "N/A" GROUP BY local_name ORDER BY device_count DESC LIMIT 10', [], (err, rows) => {
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

/**
 * Closes the database connection gracefully
 */
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