/**
 * BLE Scanner Application - Database Reset Utility
 * 
 * This utility allows for the complete reset of the BLE scanner database by
 * deleting all records from the 'scans' table. It includes a confirmation
 * prompt to prevent accidental data loss and performs database optimisation
 * after deletion.
 * 
 * The database stores BLE device information using device fingerprints
 * (derived from stable characteristics like manufacturer data and service UUIDs)
 * rather than MAC addresses, providing more reliable tracking of unique devices
 * even when they use random or changing addresses for privacy.
 * 
 * Features:
 * - User confirmation before deletion
 * - Complete removal of all scan records
 * - Database optimisation (VACUUM) to reclaim space
 * - Graceful error handling
 * - Preserves database schema for fingerprint-based tracking
 * 
 * Dependencies:
 * - sqlite3: Database access
 * - path: File path resolution
 * - readline: User input handling
 * 
 * Created: 12/Apr/2025
 */

// --- Imports ---
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const readline = require('readline'); // For user input handling

// --- Database Configuration ---
// Path to the SQLite database file
const dbPath = path.resolve(__dirname, 'ble_scans.db');

// --- User Interface Setup ---
// Create interface for user input with standard input/output
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// --- Confirmation and Deletion Process ---
// Ask for confirmation before proceeding with deletion
rl.question(`Are you sure you want to DELETE ALL DATA from the 'scans' table in ${dbPath}? (yes/no) `, (answer) => {
  if (answer.toLowerCase() === 'yes') {
    // Proceed with deletion
    const db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error(`Error opening database: ${err.message}`);
        console.error(`Make sure the database file exists at: ${dbPath}`);
        rl.close();
        process.exit(1);
      }

      console.log(`Connected to the SQLite database at ${dbPath}`);
      console.log("Deleting all records from 'scans' table...");
      console.log("Note: This will remove all device fingerprints and scan data, but preserve the database structure.");

      // --- Data Deletion ---
      // Execute deletion query and track the number of records deleted
      db.run('DELETE FROM scans', [], function(err) { // Use function() to access this.changes
        if (err) {
          console.error('Error deleting data:', err.message);
        } else {
          console.log(`Successfully deleted ${this.changes} records.`);
          
          // --- Database Optimisation ---
          // Vacuum the database to reclaim space after deletion
          console.log('Optimising database file (VACUUM)...');
          db.run('VACUUM', [], (vacErr) => {
              if (vacErr) {
                  console.error('Error optimising database:', vacErr.message);
              } else {
                  console.log('Database optimised.');
              }
              
              // --- Cleanup ---
              // Close DB regardless of vacuum outcome
              db.close((closeErr) => {
                if (closeErr) {
                  console.error('Error closing database:', closeErr.message);
                }
                console.log('Database connection closed.');
                rl.close();
              });
          });
        }
      });
    });
  } else {
    console.log('Operation cancelled. No data was deleted.');
    rl.close();
  }
}); 