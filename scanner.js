/**
 * BLE Scanner Application
 * 
 * Designed to run on a Raspberry Pi 4
 * Useful for conventions and traffic analysis at shows
 * 
 * This application scans for Bluetooth Low Energy (BLE) devices in the vicinity,
 * with a focus on identifying mobile phones. It logs device information to both
 * the console and a local SQLite database for later reporting.
 * 
 * Features:
 * - Window-based scanning (10s every minute)
 * - Device fingerprinting to handle random MAC addresses
 * - Device memory management (5-minute tracking)
 * - Ignore list for filtering out specific devices
 * - Phone detection based on manufacturer data, service UUIDs, and device names
 * - Persistent storage in SQLite database
 * - Graceful shutdown handling
 * 
 * Dependencies:
 * - @abandonware/noble: BLE communication library
 * - sqlite3: Local database storage
 * - path, fs: File system operations
 * - crypto: For device fingerprinting
 * 
 * Created: 12/Apr2025
 */

const noble = require('@abandonware/noble');
const sqlite3 = require('sqlite3').verbose(); // Use verbose for better debugging initially
const path = require('path');
const fs = require('fs'); // Import filesystem module
const crypto = require('crypto');

// --- Configuration ---
// Scanning configuration
const SCAN_WINDOW_DURATION = 10000; // 10 seconds scan window
const SCAN_INTERVAL = 60000; // 1 minute between scan starts
const DEVICE_MEMORY_DURATION = 5 * 60 * 1000; // 5 minutes (how long to remember devices)

// --- Ignore List Setup ---
// Load and parse the ignore list from a JSON file
// Note, if the addresses are of AddressType Random, then the ignore list will not work
// This list allows filtering out specific devices by their MAC addresses
let ignoredDevices = new Set(); // Use a Set for efficient lookup
const ignoreListPath = path.resolve(__dirname, 'ignore_list.json');

try {
  if (fs.existsSync(ignoreListPath)) {
    const ignoreListData = fs.readFileSync(ignoreListPath);
    const ignoredAddresses = JSON.parse(ignoreListData);
    if (Array.isArray(ignoredAddresses)) {
      // Normalise addresses to lowercase for consistent matching
      ignoredDevices = new Set(ignoredAddresses.map(addr => addr.toLowerCase()));
      console.log(`Loaded ${ignoredDevices.size} device addresses from ignore list.`);
    } else {
      console.warn('Warning: ignore_list.json does not contain a valid JSON array. Ignoring file.');
    }
  } else {
    console.log('Ignore list file (ignore_list.json) not found. All devices will be logged.');
  }
} catch (err) {
  console.error('Error reading or parsing ignore_list.json:', err);
  // Continue without ignoring devices if there's an error
}

// --- Database Setup ---
// Initialise SQLite database for storing scan results
const dbPath = path.resolve(__dirname, 'ble_scans.db'); // Store DB file in the same directory
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("Error opening database:", err.message);
  } else {
    console.log(`Connected to the SQLite database at ${dbPath}`);
    // Create table if it doesn't exist
    db.run(`CREATE TABLE IF NOT EXISTS scans (
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      id TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      address TEXT NOT NULL,
      address_type TEXT NOT NULL,
      connectable TEXT NOT NULL,
      local_name TEXT,
      tx_power_level INTEGER,
      service_uuids TEXT,
      manufacturer_data TEXT,
      rssi INTEGER NOT NULL,
      PRIMARY KEY (timestamp, fingerprint)
    )`, (err) => {
      if (err) {
        console.error("Error creating table:", err.message);
      } else {
        console.log("Table 'scans' initialised successfully.");
      }
    });
  }
});

// SQL statement for inserting data (prepared statement is often better for performance/security)
const insertSql = `INSERT INTO scans (id, fingerprint, address, address_type, connectable, local_name, tx_power_level, service_uuids, manufacturer_data, rssi) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

// --- Noble Scanning Logic ---
// Set up event handlers for the Noble BLE library
// Uses window-based scanning to manage device discovery and tracking

// Device tracking
let isScanning = false;
const seenDevices = new Map(); // fingerprint -> { timestamp, details }

// Update the noble.on('stateChange') handler
noble.on('stateChange', (state) => {
    if (state === 'poweredOn') {
        console.log('BLE radio powered on. Starting scan cycle...');
        manageScanCycle(); // Start first cycle immediately
        setInterval(manageScanCycle, SCAN_INTERVAL); // Schedule future cycles
    } else {
        console.log('Stopping BLE scan...');
        noble.stopScanning();
        isScanning = false;
    }
});

// --- Device Fingerprinting ---
// Generates a unique fingerprint for each device based on stable characteristics
// This helps track devices even when they use random MAC addresses
function generateDeviceFingerprint(peripheral) {
    const ad = peripheral.advertisement;
    const components = [
        ad.localName || '',
        ad.manufacturerData ? ad.manufacturerData.toString('hex') : '',
        (ad.serviceUuids || []).sort().join(','),
        peripheral.addressType,
        peripheral.connectable ? 'true' : 'false'
    ];
    
    return crypto.createHash('md5')
        .update(components.join('|'))
        .digest('hex');
}

// Process discovered BLE devices
noble.on('discover', (peripheral) => {
    const currentTime = Date.now();
    const fingerprint = generateDeviceFingerprint(peripheral);
    
    // Check if we've seen this device recently
    const lastSeen = seenDevices.get(fingerprint);
    if (lastSeen && (currentTime - lastSeen.timestamp) < DEVICE_MEMORY_DURATION) {
        return; // Skip if seen within the memory duration
    }
    
    // Update seen devices
    seenDevices.set(fingerprint, {
        timestamp: currentTime,
        details: {
            address: peripheral.address,
            localName: peripheral.advertisement.localName,
            rssi: peripheral.rssi
        }
    });

    const address = peripheral.address.toLowerCase();

    // --- Check Ignore List --- 
    // Skip processing if the device is in the ignore list
    if (ignoredDevices.has(address)) {
        console.log(`DEBUG: Ignoring device ${address} from ignore list.`);
        console.log('--------------------------------');
        return; // Skip processing this device
    }
    // --- End Check Ignore List ---

    // Extract device information from advertisement data
    const id = peripheral.id || 'N/A';
    const addressType = peripheral.addressType || 'N/A';
    const connectable = peripheral.connectable || 'N/A';
    const ad = peripheral.advertisement;
    const localName = ad.localName || 'N/A';
    const txPowerLevel = ad.txPowerLevel;
    const serviceUuids = ad.serviceUuids || [];
    const serviceSolicitationUuid = ad.serviceSolicitationUuid || [];
    const manufacturerData = ad.manufacturerData;
    const serviceDataUuid = ad.serviceData.uuid || 'N/A';
    const rssi = peripheral.rssi || 'N/A';

    let isLikelyPhone = false;

    // --- Filter Logic ---
    // Apply heuristics to identify likely phones

    // Check Manufacturer Data (Example: Apple)
    // Apple devices use manufacturer ID 0x004c
    if (manufacturerData && manufacturerData.length >= 2 && manufacturerData.readUInt16LE(0) === 0x004c) {
        console.log(`DEBUG: Apple Manufacturer ID detected for ${peripheral.address}`);
        isLikelyPhone = true;
    }

    // Check Service UUIDs (Example: ANCS)
    // A UUID, or Universally Unique Identifier, is a 128-bit value used to uniquely identify entities, and the Apple Notification Centre Service (ANCS) 
    // utilises specific UUIDs for its characteristics and service. The ANCS service UUID is 7905F431-B5CE-4E99-A40F-4B1E122D00D0. 
    if (!isLikelyPhone && serviceUuids.includes('7905f431b5ce4e99a40f4b1e122d00d0')) { // Note: Noble often provides lower-case UUIDs
        console.log(`DEBUG: ANCS Service UUID detected for ${peripheral.address}`);
        isLikelyPhone = true;
    }

    // Check Local Name (Example: Contains 'iPhone' or 'Pixel') - Less reliable
    // Some phones include their model in the advertisement name
    if (!isLikelyPhone && (localName.toLowerCase().includes('iphone') || localName.toLowerCase().includes('pixel'))) {
        console.log(`DEBUG: Local name match detected for ${peripheral.address}`);
        isLikelyPhone = true;
    }

    // --- End Filter Logic ---

    // Only log if it's likely a phone based on our rules
    if (isLikelyPhone) {
        // Convert manufacturer data to hexadecimal string for display and storage
        const manufacturerDataHex = manufacturerData ? manufacturerData.toString('hex') : 'N/A';

        // Log device information to console
        console.log(`  ID: ${id}`);
        console.log(`  Likely Phone Found, address: ${address}`);
        console.log(`  Address type: ${addressType}`);
        console.log(`  Connectable: ${connectable}`);
        console.log(`  Local Name: ${localName || 'N/A'}`);
        console.log(`  Tx Power Level: ${txPowerLevel || 'N/A'}`);
        console.log(`  Service UUIDs: ${serviceUuids.join(', ') || 'None'}`);
        console.log(`  Service Solicitation UUIDs: ${serviceSolicitationUuid.join(', ') || 'None'}`);
        console.log(`  Manufacturer Data: ${manufacturerDataHex}`);
        console.log(`  Service Data UUIDs: ${serviceDataUuid || 'None'}`);
        console.log(`  RSSI: ${rssi}`);
        //console.log('---'); // Separator

        // Prepare data for database insertion
        const params = [
            id,
            fingerprint,
            peripheral.address,
            addressType,
            connectable,
            localName,
            txPowerLevel,
            serviceUuids.join(','),
            manufacturerDataHex,
            rssi
        ];

        // Insert into database
        db.run(insertSql, params, function(err) { // Use standard function for 'this.lastID', 'this.changes' if needed
            if (err) {
                // Basic error logging, could be improved (e.g., check for specific errors like UNIQUE constraint)
                if (err.code !== 'SQLITE_CONSTRAINT') { // Don't log constraint errors if duplicates are expected/handled by PK
                    console.error(`Error inserting data for ${peripheral.address}:`, err.message);
                }
            } else {
                // Optional: Log successful insertion for debugging
                // console.log(`Inserted data for ${peripheral.address}`);
            }
        });

        // Optional: Still log to console if desired
        // console.log(`[DB] Logged: ${peripheral.address} (RSSI: ${peripheral.rssi})`);
        console.log('--------------------------------'); // Separator
    } else {
        // Optional: Log devices that were *not* matched for debugging filters
        // console.log(`DEBUG: Skipping device ${peripheral.address} (Name: ${localName}, Services: ${serviceUuids.join(',')}, ManuData: ${manufacturerData?.toString('hex')})`);
    }
});

// --- Graceful Shutdown ---
// Handle application termination gracefully
function shutdown() {
  console.log("\nStopping scan and closing database...");
  noble.stopScanning(() => {
    db.close((err) => {
      if (err) {
        console.error('Error closing database:', err.message);
      } else {
        console.log('Database connection closed.');
      }
      process.exit(0);
    });
  });
}

// Register signal handlers for graceful shutdown
process.on('SIGINT', shutdown);  // Catch Ctrl+C
process.on('SIGTERM', shutdown); // Catch kill commands

console.log("Scanner initialised. Press Ctrl+C to stop.");

// --- Scan Cycle Management ---
// Controls the scanning windows and device memory cleanup
function manageScanCycle() {
    if (noble.state === 'poweredOn') {
        if (!isScanning) {
            console.log('Starting scan window...');
            noble.startScanning([], true);
            isScanning = true;
            
            // Clean up old entries
            const cutoffTime = Date.now() - DEVICE_MEMORY_DURATION;
            for (const [key, value] of seenDevices.entries()) {
                if (value.timestamp < cutoffTime) {
                    seenDevices.delete(key);
                }
            }
            
            // Stop scanning after window duration
            setTimeout(() => {
                noble.stopScanning();
                isScanning = false;
                console.log('Scan window completed. Waiting for next cycle...');
            }, SCAN_WINDOW_DURATION);
        }
    }
}
