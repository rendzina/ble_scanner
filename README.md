# BLE Scanner

A Bluetooth Low Energy (BLE) scanning application designed to detect and log mobile phones in the vicinity. This tool is particularly useful for traffic analysis at events, conventions, or public spaces.

Possible use cases:
- People counting / footfall monitoring (anonymously)
- Proximity-based experiences (e.g. in a museum)
- Asset tracking with BLE beacons (Eddystone, iBeacon)

## Overview

This application continuously scans for BLE devices, with a focus on identifying mobile phones based on manufacturer data, service UUIDs, and device names. It logs detailed information about detected devices to both the console and a local SQLite database for later analysis. Note devices may not be individually identifiable if random addressing is used, however overall traffic patterns can be discerned.

## Features

- **Configurable Scan Interval**: Adjust the frequency of scans (default: 1 minute)
- **Ignore List**: Filter out specific devices by their MAC addresses
- **Phone Detection**: Identify likely phones using multiple heuristics:
  - Apple manufacturer ID detection
  - Apple Notification Centre Service (ANCS) UUID detection
  - Device name pattern matching (iPhone, Pixel)
- **Persistent Storage**: Log device information to a SQLite database
- **Statistics Reporting**: Generate detailed reports on detected devices
- **Database Management**: Tools for resetting and managing the database

## Requirements

- Node.js (v14 or higher recommended)
- Bluetooth adapter with BLE support
- Linux-based system (tested on Raspberry Pi 4)

## Installation

1. Ensure the Pi is fully up to date
   ```
   sudo apt update && sudo apt upgrade -y
   ```
2. Install Bluetooth tools and dependencies
   ```
   sudo apt install bluetooth bluez libbluetooth-dev libudev-dev -y
   ```
3. If you don't already have Node.js installed:
   ```
   curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
   sudo apt install -y nodejs
   ```
   and check it all installed OK
   ```
   node -v
   npm -v
   ```
4. Ensure your Bluetooth adapter is enabled and has the necessary permissions:
   ```
   sudo setcap cap_net_raw+eip $(eval readlink -f $(which node))
   ```

5. Clone this repository (assumes git is installed):
   ```
   mkdir ble-scanner
   cd ble-scanner
   git clone https://github.com/rendzina/ble-scanner.git
   ```

6. Install dependencies:
   ```
   npm install @abandonware/noble
   npm install sqlite3
   ```


## Usage

### Running the Scanner

Start the BLE scanner:

```
node scanner.js
```

The scanner will:
- Load the ignore list (if present)
- Initialise the database
- Begin scanning for BLE devices
- Log likely phones to the console and database

Press `Ctrl+C` to stop the scanner gracefully.

### Viewing Statistics

Generate a report of detected devices:

```
node stats.js
```

This will display:
- Total scan count and unique device statistics
- Time range of collected data
- Signal strength (RSSI) statistics
- Busiest hours analysis
- Device history tracking
- Manufacturer data analysis
- Service UUID analysis
- Device consistency tracking
- Transmission power level analysis
- Local name analysis

### Resetting the Database

To clear all data from the database:

```
node reset.js
```

You will be prompted to confirm the deletion.

### Ignore List

Create a file named `ignore_list.json` in the project directory with an array of MAC addresses to ignore:

```json
[
  "00:11:22:33:44:55",
  "aa:bb:cc:dd:ee:ff"
]
```

**Note**: The ignore list will not work for devices with random addresses.

## Database Schema

The application uses a SQLite database with the following schema:

```sql
CREATE TABLE scans (
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  address TEXT NOT NULL,
  local_name TEXT,
  tx_power_level INTEGER,
  service_uuids TEXT,
  manufacturer_data TEXT,
  rssi INTEGER NOT NULL,
  PRIMARY KEY (timestamp, address)
)
```

## Customisation

### Scan Interval

Modify the `SCAN_INTERVAL_MS` constant in `scanner.js` to change the scan frequency:

```javascript
const SCAN_INTERVAL_MS = 60000; // 1 minute
// 30000 for 30 seconds
// 120000 for 2 minutes
// 300000 for 5 minutes
```

### Phone Detection Logic

The phone detection logic can be customised in the `scanner.js` file by modifying the filter logic section.

## Troubleshooting

### Bluetooth Adapter Issues

If you encounter issues with the Bluetooth adapter:

1. Ensure the adapter is enabled:
   ```
   sudo hciconfig hci0 up
   ```

2. Check Bluetooth service status:
   ```
   sudo systemctl status bluetooth
   ```

3. Restart the Bluetooth service if needed:
   ```
   sudo systemctl restart bluetooth
   ```

### Database Errors

If you encounter database errors:

1. Check file permissions on the database file
2. Ensure the directory is writable
3. Try resetting the database using `reset.js`

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgements

- [@abandonware/noble](https://github.com/abandonware/noble) - BLE communication library
- [sqlite3](https://github.com/mapbox/node-sqlite3) - SQLite database driver for Node.js 
