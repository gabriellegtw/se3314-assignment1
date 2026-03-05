let net = require("net");
let fs = require("fs");
let open = require("open");
let MTPpacket = require("./MTPRequest"),// uncomment this line after you run npm install command

singleton = require("./Singleton");
console.log('🔧 INITIALIZING keyParts array at:', new Date().toISOString());
// let keyParts = []; 
let responseTimeout = null;
let lastAckSent = null;

let keyParts = [null, null, null];  // Change to fixed size array
let pendingKeyParts = {};  // New: track chunks for each part number

// Add near the top with other globals
const KEY_PARTS_FILE = './key_parts.json';
let currentSessionId = null;

// Load saved key parts on startup
function loadSavedKeyParts() {
    try {
        if (fs.existsSync(KEY_PARTS_FILE)) {
            const saved = fs.readFileSync(KEY_PARTS_FILE, 'utf8');
            const data = JSON.parse(saved);
            keyParts = data.keyParts || [null, null, null];
            currentSessionId = data.sessionId || null;
            console.log('📂 Loaded saved key parts:', keyParts);
            console.log('🔐 Saved session ID:', currentSessionId);
        } else {
            console.log('🆕 No saved key parts found, starting fresh');
        }
    } catch (e) {
        console.log('⚠️ Error loading saved key parts:', e.message);
    }
}

// Save key parts to file
function saveKeyParts() {
    try {
        const data = {
            keyParts: keyParts,
            sessionId: currentSessionId,
            timestamp: new Date().toISOString()
        };
        fs.writeFileSync(KEY_PARTS_FILE, JSON.stringify(data, null, 2));
        console.log('💾 Saved key parts to disk:', keyParts);
    } catch (e) {
        console.log('⚠️ Error saving key parts:', e.message);
    }
}

// Call this at startup
loadSavedKeyParts();

// call as GetImage -s <serverIP>:<port> -q <image name> -v <version>

// Enter your code for the client functionality here
// You should connect to the server and send the request packet
// You should receive the response packet from the server
// You should print the response packet in bits format
// You should extract the media data from the response packet
// You should save the image data to a file

// Parse command line arguments
function parseArgs() {
    const args = process.argv.slice(2);
    let result = {
        server: null,
        query: null,
        version: 11,
        type: null
    };
    
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '-s' && i + 1 < args.length) {
            result.server = args[++i];
        } else if (args[i] === '-q' && i + 1 < args.length) {
            result.query = args[++i];
        } else if (args[i] === '-v' && i + 1 < args.length) {
            result.version = parseInt(args[++i]);
        } else if (args[i] === '--type' && i + 1 < args.length) {
            result.type = args[++i];
        }
    }
    
    return result;
}

// Get media type from filename extension
function getMediaType(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const types = {
        'bmp': 1, 'jpg': 2, 'jpeg': 2, 'tiff': 3, 'gif': 4,
        'png': 5, 'avi': 6, 'mp4': 7, 'mov': 8, 'raw': 15
    };
    return types[ext] || 1;
}

// Main execution
const args = parseArgs();

// start here
if (!args.server) {
    console.error('Usage: node GetMedia -s <serverIP:port> [-q <media name>] -v <version> --type <secret/query>');
    process.exit(1);
}

// Parse server address
const [host, port] = args.server.split(':');
if (!host || !port) {
    console.error('Invalid server address. Use format: ip:port');
    process.exit(1);
}

console.log(`Connected to MediaDB server on: ${host}:${port}`);

// Determine request type
let requestType = 1; // Default Query
if (args.type === 'secret') requestType = 2;
else if (args.type === 'ack') requestType = 3;
else if (args.type === 'reset') requestType = 5;

// Handle filename (optional for secret sessions)
let fullFilename = args.query;
let baseFilename = "";
let mediaType = 0;

if (args.query) {
    // User provided a filename
    fullFilename = args.query;
    baseFilename = fullFilename.includes('.') ? 
        fullFilename.substring(0, fullFilename.lastIndexOf('.')) : fullFilename;
    mediaType = getMediaType(fullFilename);
    
    // Check for .txt extension to auto-set request type (optional feature)
    if (fullFilename.toLowerCase().endsWith('.txt')) {
        requestType = 4; // Complete request for text files
        loadSavedKeyParts();
    
        if (keyParts[0] && keyParts[1] && keyParts[2]) {
            global.savedKey = keyParts.join('');
            console.log(`🔐 Using saved key: "${global.savedKey}"`);
        }
    }
    
    console.log(`Requesting: ${fullFilename} (base: ${baseFilename}, type: ${mediaType})`);
} else if (requestType === 2) {
    // Secret session without a filename
    console.log('Initiating secret session (no specific file requested)');
    baseFilename = "";
    mediaType = 0;
} else {
    // Non-secret request requires a filename
    console.error('Error: -q <media name> is required for non-secret requests');
    console.error('Usage: node GetMedia -s <serverIP:port> -q <media name> -v <version> --type <secret/query>');
    process.exit(1);
}

console.log(`Version: ${args.version}`);
console.log(`Request type: ${args.type} (${requestType})`);

global.currentRequestType = requestType;
global.requestedFilename = fullFilename || "secret_session";

// Initialize MTPpacket with request data
const timestamp = singleton.getTimestamp();
MTPpacket.init(requestType, timestamp, mediaType, baseFilename);

// Get the complete request packet
const requestPacket = MTPpacket.getBytePacket();

console.log('\nMTP request packet sent:');
printPacketBit(requestPacket);

// Connect to server
const client = net.createConnection(parseInt(port), host, () => {
    resetTimeout();
    console.log('Connected to server, sending request...');
    client.write(requestPacket);
});
// end here

// Response handling
let responseBuffer = Buffer.alloc(0);
let responseHeader = null;
let fileData = Buffer.alloc(0);
let packetsReceived = 0;
let expectedPayloadSize = 0;

client.on('data', (data) => {
    resetTimeout();
    console.log(`Received ${data.length} bytes from server`);

    responseBuffer = Buffer.concat([responseBuffer, data]);
    
    // Process all complete packets in buffer
    while (responseBuffer.length >= 12) {
        if (!responseHeader) {
            // Parse header
            responseHeader = parseResponseHeader(responseBuffer);
            
            console.log('\nMTP packet header received:');
            printPacketBit(responseBuffer.slice(0, 12));
            
            console.log('\nServer sent:');
            console.log(`--MTP version = ${responseHeader.version}`);
            console.log(`--Response Type = ${getResponseTypeName(responseHeader.responseType)}`);
            console.log(`--Sequence Number = ${responseHeader.sequenceNum}`);
            console.log(`--Last Flag = ${responseHeader.lastFlag}`);
            console.log(`--Payload Size = ${responseHeader.payloadSize} bytes`);
            
            expectedPayloadSize = responseHeader.payloadSize;
            
            // Remove header from buffer
            responseBuffer = responseBuffer.slice(12);
            
            // If no payload, packet is complete
            if (expectedPayloadSize === 0) {
                console.log('Empty payload (likely Not Found response)');
                responseHeader = null;
                packetsReceived++;
            }
        } else {
            // We're collecting payload
            const bytesNeeded = expectedPayloadSize - fileData.length;
            const bytesToTake = Math.min(bytesNeeded, responseBuffer.length);
            
            fileData = Buffer.concat([fileData, responseBuffer.slice(0, bytesToTake)]);
            responseBuffer = responseBuffer.slice(bytesToTake);
            
            // Check if we have complete payload
            if (fileData.length >= expectedPayloadSize) {
                console.log(`Complete packet ${packetsReceived} received (${fileData.length} bytes payload)`);
                const wasLastPacket = responseHeader.lastFlag;
                handleResponse(responseHeader, fileData);
                resetTimeout();
                
                responseHeader = null;
                packetsReceived++;
                fileData = Buffer.alloc(0);
                
                // If this was the last packet, we might close
                if (wasLastPacket) {
                    break;
                }
            }
        }
    }
});

client.on('end', () => {
    console.log('\nDisconnected from the server');
    console.log('Connection closed');
    process.exit(0); // Exit cleanly
});

client.on('error', (err) => {
    console.error('Client error:', err.message);
});

// Adding a timeout to ensure that we can retype in the terminal after 
setTimeout(() => {
    if (client) {
        client.end();
        process.exit(0);
    }
}, 5000);

function parseResponseHeader(buffer) {
    if (buffer.length < 12) return null;
    
    // Version (5 bits) and Response Type (3 bits) from byte 0
    const version = (buffer[0] >> 3) & 0x1F;
    const responseType = buffer[0] & 0x07;
    
    // Sequence Number (24 bits) from bytes 1-3
    const sequenceNum = (buffer[1] << 16) | (buffer[2] << 8) | buffer[3];
    
    // Reserved (32 bits) from bytes 4-7
    const reserved = (buffer[4] << 24) | (buffer[5] << 16) | 
                     (buffer[6] << 8) | buffer[7];
    
    // Last flag (1 bit) and Payload Size (31 bits) from bytes 8-11
    const lastFlag = (buffer[8] >> 7) & 0x01;
    const payloadSize = ((buffer[8] & 0x7F) << 24) | 
                        (buffer[9] << 16) | 
                        (buffer[10] << 8) | 
                        buffer[11];
    
    return {
        version, responseType, sequenceNum, reserved, lastFlag, payloadSize
    };
}

// // REPLACE your entire existing handleResponse function with this
function handleResponse(header, payload) {
    console.log('\n🔍 HANDLE RESPONSE DEBUG:');
    console.log(`   responseType: ${header.responseType}`);
    console.log(`   reserved: 0x${header.reserved.toString(16).padStart(8, '0')}`);
    console.log(`   sequenceNum: ${header.sequenceNum}`);
    console.log(`   lastFlag: ${header.lastFlag}`);
    
    if (header.responseType === 1) { // Found
        
        // Check if this is a secret session packet (reserved has data)
        // If it is a normal query the reserved is 0
        if (header.reserved !== 0) {
            
            // Decode the reserved field
            const decoded = decodeReserved(header.reserved);
            const partNum = decoded.partNum;
            const chars = (decoded.char1 + decoded.char2).replace(/\0/g, '');
            
            console.log(`\n🔑 Packet decoded:`);
            console.log(`   Part Number: ${partNum}`);
            console.log(`   Window ID: ${decoded.windowId}`);
            console.log(`   Characters: "${chars}"`);
            
            // Initialize storage for this part if needed
            if (!pendingKeyParts[partNum]) {
                pendingKeyParts[partNum] = {
                    chunks: [],        // Store character chunks
                    packetCount: 0,    // Number of packets received
                    fileData: null     // Will store file when received
                };
                console.log(`   🆕 Started tracking part ${partNum}`);
            }
            
            // Store non-null characters
            if (chars.length > 0) {
                pendingKeyParts[partNum].chunks.push(chars);
                pendingKeyParts[partNum].packetCount++;
                console.log(`   📦 Stored chunk: "${chars}" (total chunks: ${pendingKeyParts[partNum].chunks.length})`);
            }
            
            // If this is the last packet (has payload and lastFlag=1)
            if (header.lastFlag === 1 && payload.length > 0) {
                console.log(`\n📁 Received file data (${payload.length} bytes)`);
                pendingKeyParts[partNum].fileData = payload;
                
                // Reconstruct the full key part from all stored chunks
                const fullKeyPart = pendingKeyParts[partNum].chunks.join('');
                console.log(`\n✅ Reconstructed key part ${partNum}: "${fullKeyPart}"`);
                
                // Store in final key parts array
                keyParts[partNum - 1] = fullKeyPart;

                saveKeyParts();
                
                // Show all key parts so far
                console.log('\n📊 Current key parts:');
                keyParts.forEach((part, i) => {
                    console.log(`   Part ${i+1}: ${part ? `"${part}"` : '[missing]'}`);
                });
                
                // Send ACK for this part
                sendAck(header.reserved);
                
                // Check if we have all 3 parts
                if (keyParts[0] && keyParts[1] && keyParts[2]) {
                    console.log('\n🎉 ===== ALL 3 KEY PARTS COLLECTED =====');
                    const fullKey = keyParts.join('');
                    console.log(`   Full key: "${fullKey}"`);
                    console.log('=====================================\n');
                    decodeSaveAndOpenFile(data, filename, fullKey);
                    // Send COMPLETE request
                    // setTimeout(() => {
                    //     sendRequest(4, "secret", 0);
                    // }, 500);
                } else {
                    // Save the file
                    saveAndOpenFile(payload, global.requestedFilename); 
                }
            }
        } 
        else if (global.currentRequestType === 2) {
            // This was a SECRET request - response is a RIDDLE
            console.log('\n📜 ===== RIDDLE RECEIVED =====');
            console.log(payload.toString());
            console.log('============================\n');
            console.log('Automatically requesting files in order:');
            
            // Reset state for new secret session
            keyParts = [null, null, null];
            pendingKeyParts = {};
            currentFileIndex = 0;

            // Reset state
            currentSessionId = null;
            
            // Delete the saved file
            try {
                fs.unlinkSync(KEY_PARTS_FILE);
                console.log('🗑️ Cleared saved key parts');
            } catch (e) {
                console.log("Something went wrong in clearing the key file");
            }
        }
        else {
            // Normal file without key part
            saveAndOpenFile(payload, global.requestedFilename);
        }
    } else if (header.responseType === 2) { // Not Found
        console.log('\n❌ File not found on server');
        if (payload.length > 0) {
            console.log('Error message:', payload.toString());
        }
    } else if (header.responseType === 3) { // Busy
        console.log('\n⏳ Server is busy');
    }
}

// New function to send ACK automatically
// Replace your entire sendAck function with this:
function sendAck(reservedValue) {
    console.log('\n📨 ===== SENDING ACK =====');
    console.log(`   Reserved value to echo: 0x${reservedValue.toString(16)}`);
    
    const timestamp = singleton.getTimestamp();
    MTPpacket.init(3, timestamp, 0, "");
    
    let ackPacket = MTPpacket.getBytePacket();
    console.log('   Original packet:', ackPacket.slice(0,12).toString('hex'));
    
    // Set reserved field
    ackPacket[4] = (reservedValue >> 24) & 0xFF;
    ackPacket[5] = (reservedValue >> 16) & 0xFF;
    ackPacket[6] = (reservedValue >> 8) & 0xFF;
    ackPacket[7] = reservedValue & 0xFF;
    
    console.log('   Modified packet: ', ackPacket.slice(0,12).toString('hex'));
    console.log('   Sending ACK...');
    
    client.write(ackPacket);
    console.log('✅ ACK sent');
    console.log('========================\n');

    // Remember that we sent this ACK
    lastAckSent = reservedValue;
    
    // Clear after 1 second (in case we need to send a different one)
    setTimeout(() => {
        lastAckSent = null;
    }, 1000);
}

// Helper to decode reserved field
// function decodeReserved(reserved) {
//     return {
//         char1: (reserved >> 24) & 0xFF,
//         char2: (reserved >> 16) & 0xFF,
//         partNum: (reserved >> 8) & 0xFF,
//         windowId: reserved & 0xFF
//     };
// }

function decodeReserved(reserved) {
    return {
        char1: String.fromCharCode((reserved >> 24) & 0xFF),
        char2: String.fromCharCode((reserved >> 16) & 0xFF),
        partNum: (reserved >> 8) & 0xFF,   // partNum is in bits 8-15
        windowId: reserved & 0xFF           // windowId is in bits 0-7
    };
}

// function decodeReserved(reserved) {
//     return {
//         partNum: (reserved >> 24) & 0xFF,
//         windowId: (reserved >> 16) & 0xFF,
//         char1: String.fromCharCode((reserved >> 8) & 0xFF),
//         char2: String.fromCharCode(reserved & 0xFF),
//         char1Code: (reserved >> 8) & 0xFF,
//         char2Code: reserved & 0xFF
//     };
// }

function getResponseTypeName(type) {
    const types = ['Query', 'Found', 'Not Found', 'Busy'];
    return types[type] || 'Unknown';
}

function saveAndOpenFile(data, filename) {
    const outputFilename = `downloaded_${filename}`;
    
    fs.writeFileSync(outputFilename, data);
    console.log(`\n✅ File saved as: ${outputFilename} (${data.length} bytes)`);
    
    // Open with default viewer
    console.log('Opening with default viewer...');
    open(outputFilename);
}

function decodeSaveAndOpenFile(data, filename, fullKey) {
    const outputFilename = `downloaded_${filename}`;
    
    fs.writeFileSync(outputFilename, data);
    const content = data.toString('utf8');
    let result = "";
    let j = 0;  // Key index

    for (let i = 0; i < content.length; i++) {
        const char = content[i];
        
        // Reset j if it reaches key length
        if (j >= fullKey.length) {
            j = 0;
        }
        
        // Only process letters
        if (char.match(/[A-Za-z]/)) {
            const isUpper = char === char.toUpperCase();
            const charCode = char.toUpperCase().charCodeAt(0) - 65;
            const keyCode = fullKey[j].toUpperCase().charCodeAt(0) - 65;
            
            // Vigenère decryption formula
            let decryptedCode = (charCode - keyCode + 26) % 26;
            let decryptedChar = String.fromCharCode(decryptedCode + 65);
            
            // Restore original case
            result += isUpper ? decryptedChar : decryptedChar.toLowerCase();
            j++;  // Move to next key character
        } else {
            // Keep non-letters unchanged
            result += char;
        }
    }

    const decryptedFilename = `decrypted_${filename}`;
    fs.writeFileSync(decryptedFilename, result);
    open(decryptedFilename);
}

//some helper functions
// return integer value of the extracted bits fragment
function parseBitPacket(packet, offset, length) {
  let number = "";
  for (var i = 0; i < length; i++) {
    // let us get the actual byte position of the offset
    let bytePosition = Math.floor((offset + i) / 8);
    let bitPosition = 7 - ((offset + i) % 8);
    let bit = (packet[bytePosition] >> bitPosition) % 2;
    number = (number << 1) | bit;
  }
  return number;
}

// Prints the entire packet in bits format
function printPacketBit(packet) {
  var bitString = "";

  for (var i = 0; i < packet.length; i++) {
    // To add leading zeros
    var b = "00000000" + packet[i].toString(2);
    // To print 4 bytes per line
    if (i > 0 && i % 4 == 0) bitString += "\n";
    bitString += " " + b.substr(b.length - 8);
  }
  console.log(bitString);
}
function bytes2string(array) {
  var result = "";
  for (var i = 0; i < array.length; ++i) {
    result += String.fromCharCode(array[i]);
  }
  return result;
}

// ============= INTERACTIVE MODE =============
// If this was a secret session start, enter interactive mode
// if (args.type === 'secret') {
//     // Wait a bit for the riddle to be processed
//     setTimeout(() => {
//         startInteractiveMode();
//     }, 500);
// }

function startInteractiveMode() {
    const readline = require('readline');
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    
    console.log('\n🔐 SECRET SESSION ACTIVE - Connection kept alive');
    console.log('Enter commands:');
    console.log('  - Type a filename (e.g., Rose.gif) to request it');
    console.log('  - Type "complete" to request the secret file');
    console.log('  - Type "exit" to quit\n');
    
    rl.on('line', (input) => {
        input = input.trim();
        
        if (input === 'exit') {
            console.log('Exiting...');
            client.end();
            rl.close();
            return;
        }
        
        if (input === 'complete') {
            console.log('📦 Sending COMPLETE request...');
            sendRequest(4, "", 0);  // type=4 for Complete
        } else {
            // Send query for file
            const baseName = input.includes('.') ? 
                input.substring(0, input.lastIndexOf('.')) : input;
            const mediaType = getMediaType(input);
            console.log(`📁 Requesting file: ${input}`);
            sendRequest(1, baseName, mediaType);  // type=1 for Query
        }
    });
    
    // Handle client disconnect
    client.on('end', () => {
        console.log('\nConnection closed by server');
        rl.close();
        process.exit(0);
    });
}

// Helper function to send requests
function sendRequest(type, filename, mediaTypeValue) {
    const timestamp = singleton.getTimestamp();

    resetTimeout();
    // Re-initialize MTPpacket with new request
    MTPpacket.init(type, timestamp, mediaTypeValue, filename);
    const packet = MTPpacket.getBytePacket();
    
    console.log('Sending request...');
    client.write(packet);
}

function resetTimeout() {
    // Clear existing timeout
    if (responseTimeout) {
        clearTimeout(responseTimeout);
        responseTimeout = null;
    }
    
    // Set new timeout
    responseTimeout = setTimeout(() => {
        console.log('\n⏰ TIMEOUT CHECK:');
        console.log('   Response Header: ', responseHeader);
        console.log('   fileData length: ', fileData.length);
        console.log('   packetsReceived: ', packetsReceived);
        
        // Only timeout if we're not in interactive mode waiting for input
        if (!responseHeader && fileData.length === 0 && packetsReceived === 0) {
            console.log('\n❌ Timeout: No response received');
            client.end();
        } else {
            console.log('   ✅ Not timing out - activity detected');
        }
    }, 30000); // 30 seconds
}