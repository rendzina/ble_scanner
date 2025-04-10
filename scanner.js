/**
 * BLE Scanner Application
 * 
 * Designed to run on a Raspberry Pi 4
 * Useful for conventions and traffic analysis at shows
 * 
 * This application scans for Bluetooth Low Energy (BLE) devices in the vicinity,
 * with a focus on identifying mobile phones. It logs device information to both
 * the console and a local SQLite database.
 * 
 * Features:
 * - Configurable scan interval
 * - Ignore list for filtering out specific devices
 * - Phone detection based on manufacturer data, service UUIDs, and device names
 * - Persistent storage in SQLite database
 * - Graceful shutdown handling
 * 
 * Dependencies:
 * - @abandonware/noble: BLE communication library
 * - sqlite3: Local database storage
 * - path, fs: File system operations
 * 
 * Created: 2025
 */

const noble = require('@abandonware/noble');
const sqlite3 = require('sqlite3').verbose(); // Use verbose for better debugging initially
const path = require('path');
const fs = require('fs'); // Import filesystem module

// --- Configuration ---
const SCAN_INTERVAL_MS = 60000; // Time between scans in milliseconds (1 minute)
//30000 for 30 seconds
//120000 for 2 minutes
//300000 for 5 minutes
let lastScanTime = 0; // Track the last scan time

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
      address TEXT NOT NULL,
      local_name TEXT,
      tx_power_level INTEGER,
      service_uuids TEXT,
      manufacturer_data TEXT,
      rssi INTEGER NOT NULL,
      PRIMARY KEY (timestamp, address) -- Composite primary key to prevent duplicate entries
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
const insertSql = `INSERT INTO scans (address, rssi, local_name, service_uuids, manufacturer_data) VALUES (?, ?, ?, ?, ?)`;

// --- Noble Scanning Logic ---
// Set up event handlers for the Noble BLE library

// Handle Bluetooth state changes (powered on/off)
noble.on('stateChange', (state) => {
  if (state === 'poweredOn') {
    console.log('Starting BLE scan...');
    console.log('--------------------------------'); // Separator
    noble.startScanning([], true); // Allow duplicates
  } else {
    console.log('Stopping BLE scan...');
    noble.stopScanning();
  }
});

// Process discovered BLE devices
noble.on('discover', (peripheral) => {
  const currentTime = Date.now();
  
  // Check if enough time has passed since the last scan
  // This prevents excessive database entries and console output
  if (currentTime - lastScanTime < SCAN_INTERVAL_MS) {
    return; // Skip this reading if not enough time has passed
  }
  
  lastScanTime = currentTime; // Update the last scan time

  const address = peripheral.address.toLowerCase(); // Normalise discovered address

  // --- Check Ignore List --- 
  // Skip processing if the device is in the ignore list
  if (ignoredDevices.has(address)) {
    // Optional: Log that a device was ignored
    console.log(`DEBUG: Ignoring device ${address} from ignore list.`);
    console.log('--------------------------------'); // Separator
    return; // Skip processing this device
  }
  // --- End Check Ignore List ---

  // Extract device information from advertisement data
  const addressType = peripheral.addressType || 'N/A';
  const ad = peripheral.advertisement;
  const localName = ad.localName || 'N/A';
  const txPowerLevel = ad.txPowerLevel || 'N/A';
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
    console.log(`Likely Phone Found, address: ${address}`);
    console.log(`  Address type: ${addressType}`);
    console.log(`  Local Name: ${localName || 'N/A'}`);
    console.log(`  Tx Power Level: ${txPowerLevel || 'N/A'}`);
    console.log(`  Service UUIDs: ${serviceUuids.join(', ') || 'None'}`);
    console.log(`  Service Solicitation UUIDs: ${serviceSolicitationUuid.join(', ') || 'None'}`);
    console.log(`  Manufacturer Data: ${manufacturerDataHex}`);
    console.log(`  Service Data UUIDs: ${serviceDataUuid || 'None'}`);
    console.log(`  RSSI: ${rssi}`);
    //console.log('---'); // Separator

    // Prepare data for database insertion
    const params = [peripheral.address, rssi, localName, serviceUuids.join(','), manufacturerDataHex];

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
