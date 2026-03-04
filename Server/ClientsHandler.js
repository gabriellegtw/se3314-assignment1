var MTPpacket = require("./MTPResponse"),
singleton = require("./Singleton");
var path = require('path');
var fs = require('fs');
var SecretHandler = require('./SecretHandler');

// You need to add some statements here
// Since header is 12 bytes
const HEADER_SIZE = 12;
const secretHandler = new SecretHandler();
const clientSessions = {};

module.exports = {
  handleClientJoining: function (sock) {
    const clientId = sock.remotePort; // Use port as ID
    console.log(`Client ${clientId} connected`);
    
    // Get or create session for this client
    if (!clientSessions[clientId]) {
        clientSessions[clientId] = {
            secretSession: null
        };
    }
    
    let clientBuffer = Buffer.alloc(0);
    
    sock.on('data', (data) => {
        clientBuffer = Buffer.concat([clientBuffer, data]);
        processClientData(sock, clientBuffer, clientId); // Pass ID, not session
    });
    
    sock.on('close', () => {
        console.log(`Client ${clientId} closed connection`);
        // Optionally keep session or delete after timeout
        // delete clientSessions[clientId];
    });
    
    sock.on('error', (err) => {
        console.log(`Client ${clientId} error: ${err.message}`);
    });
  }

};

function handleClientLeaving(sock) {
  console.log(`Client ${sock.remotePort} closed connection`);
}

function processClientData(sock, buffer, clientId) {
    const clientSession = clientSessions[clientId];
    // Need at least 12 bytes for header
    while (buffer.length >= HEADER_SIZE) {

        // Should always be 11
        const version = parseBitPacket(buffer, 0, 5);
        
        // Reserved (24 bits) - not used for basic query
        const reserved = (parseBitPacket(buffer, 5, 8) << 16) |
                         (parseBitPacket(buffer, 13, 8) << 8) |
                         parseBitPacket(buffer, 21, 8);

        const requestType = parseBitPacket(buffer, 29, 3);
        
        // Timestamp (32 bits)
        const timestamp = (parseBitPacket(buffer, 32, 8) << 24) |
                          (parseBitPacket(buffer, 40, 8) << 16) |
                          (parseBitPacket(buffer, 48, 8) << 8) |
                          parseBitPacket(buffer, 56, 8);
        
        // Media Type (4 bits)
        const mediaType = parseBitPacket(buffer, 64, 4);
        
        // Filename Size (28 bits)
        const filenameSize = (parseBitPacket(buffer, 68, 4) << 24) |
                             (parseBitPacket(buffer, 72, 8) << 16) |
                             (parseBitPacket(buffer, 80, 8) << 8) |
                             parseBitPacket(buffer, 88, 8);
        
        // Check if we have the full filename
        if (buffer.length < HEADER_SIZE + filenameSize) {
            return;  // Wait for more data
        }
        
        // Extract filename
        const filenameBuffer = buffer.slice(HEADER_SIZE, HEADER_SIZE + filenameSize);
        const filename = bytesToString(filenameBuffer);
        
        let fullFilename = filename;
        switch(mediaType) {
            case 1: fullFilename += ".bmp"; break;
            case 2: fullFilename += ".jpg"; break;
            case 3: fullFilename += ".tiff"; break;
            case 4: fullFilename += ".gif"; break;
            case 5: fullFilename += ".png"; break;
            case 6: fullFilename += ".avi"; break;
            case 7: fullFilename += ".mp4"; break;
            case 8: fullFilename += ".mov"; break;
            case 15: fullFilename += ".raw"; break;
            default: fullFilename += ".bin"; 
                console.log(`Unknown media type: ${mediaType}`);
        }

        // Log the request (as required by assignment)
        console.log(`\nClient-${sock.remotePort} requests:`);
        console.log(`- MTP version: ${version}`);
        console.log(`- Request type: ${getRequestTypeName(requestType)}`);
        console.log(`- Media file name: ${fullFilename}`);
        
        // Print packet in bits format (required)
        console.log('MTP packet received:');
        printPacketBit(buffer.slice(0, HEADER_SIZE + filenameSize));
        
        // Remove processed data from buffer
        // This modifies the original buffer by reference
        buffer = buffer.slice(HEADER_SIZE + filenameSize);
        
        // Handle based on request type
        // For now, only handle Query (type 1)
        // Route to appropriate handler based on request type
        switch(requestType) {
            case 1: // Query
                handleQuery(sock, fullFilename, clientSession);
                break;
            case 2: // Secret
                handleSecret(sock, clientId);
                break;
            case 3: // ACK
                handleAck(sock, clientId);
                break;
            case 4: // Complete
                handleComplete(sock, clientId);
                break;
            case 5: // Reset
                handleReset(sock, clientId);
                break;
            default:
                console.log(`Unknown request type: ${requestType}`);
                sendNotFound(sock);
        }
    }
}

// Helper to convert request type number to name
function getRequestTypeName(type) {
    const types = ['?', 'Query', 'Secret', 'ACK', 'Complete', 'Reset'];
    return types[type] || 'Unknown';
}

function handleQuery(sock, filename) {
    const imagePath = path.join(__dirname, 'images', filename);
    
    console.log(`Handling Query for file: ${imagePath}`);
    
    // Check if file exists
    fs.access(imagePath, fs.constants.F_OK, (err) => {
        if (err) {
            console.log(`File ${filename} not found`);
            sendNotFound(sock);
        } else {
            console.log(`File ${filename} found, sending...`);
            sendFile(sock, imagePath, filename);
        }
    });
}

function handleQuery(sock, filename, clientSession) {
    // Check if this client has an active secret session
    if (clientSession.secretSession && !clientSession.secretSession.complete) {
        // This is a secret session file request
        console.log(`🔐 Secret session file request: ${filename}`);
        handleSecretFileRequest(sock, filename, clientSession);
        return;
    }
    
    // Normal query handling
    console.log(`📁 Normal query for: ${filename}`);
    const imagePath = path.join(__dirname, 'images', filename);
    
    fs.access(imagePath, fs.constants.F_OK, (err) => {
        if (err) {
            console.log(`   File not found: ${filename}`);
            sendNotFound(sock);
        } else {
            console.log(`   File found: ${filename}`);
            sendNormalFile(sock, imagePath, filename);
        }
    });
}

// Placeholder for secret file requests
function handleSecretFileRequest(sock, filename, clientSession) {
    const session = clientSession.secretSession;
    
    if (!session) {
        console.log(`   ❌ No active session`);
        sendError(sock, "No active secret session");
        return;
    }
    
    console.log(`\n🔑 Secret file request: ${filename}`);
    
    // ===== CHECK 1: Window validity =====
    if (!secretHandler.isWindowValid(session.startWindow)) {
        console.log(`   ❌ Session expired - window changed`);
        sendError(sock, "Session expired - time window changed");
        clientSession.secretSession = null;
        return;
    }
    
    // ===== CHECK 2: Waiting for ACK? =====
    if (session.awaitingAck) {
        console.log(`   ❌ Must send ACK first (waiting for part ${session.lastKeyPartNum})`);
        sendError(sock, `Must send ACK for part ${session.lastKeyPartNum} first`);
        return;
    }
    
    // ===== CHECK 3: All files already requested? =====
    if (session.nextFileIndex >= 3) {
        console.log(`   ❌ All files already requested`);
        sendError(sock, "All secret files already received. Send COMPLETE request.");
        return;
    }
    
    // ===== CHECK 4: Correct file order? =====
    const expectedFile = session.expectedFiles[session.nextFileIndex];
    if (filename !== expectedFile) {
        console.log(`   ❌ Wrong file order! Expected ${expectedFile}, got ${filename}`);
        sendError(sock, `Wrong file sequence. Expected ${expectedFile}`);
        // Wrong order kills the session
        clientSession.secretSession = null;
        return;
    }
    
    // ===== All checks passed - send file with key part =====
    console.log(`   ✅ Correct file! Sending with key part ${session.nextFileIndex + 1}`);
    session.awaitingAck = true;
    sendFileWithKeyPart(sock, filename, clientSession);
}

// function sendFileWithKeyPart(sock, filename, clientSession) {
//     const session = clientSession.secretSession;
//     const fileIndex = session.nextFileIndex;
//     const partNum = fileIndex + 1;
    
//     // 🔴 GUARD 1: Check if this file should be sent now
//     if (filename !== session.expectedFiles[fileIndex]) {
//         console.log(`   ⚠️ Not sending ${filename} - not the current expected file`);
//         return;
//     }
    
//     // 🔴 GUARD 2: Check if this file was already sent
//     if (session.fileSent[fileIndex]) {
//         console.log(`   ⚠️ File ${filename} already sent, ignoring duplicate call`);
//         return;
//     }
    
//     // Split the key and get the right part
//     const keyParts = secretHandler.splitKey(session.variant.key);
//     const keyPart = keyParts[fileIndex];
    
//     console.log(`   🔑 Sending key part ${partNum}/3: "${keyPart}"`);
    
//     // Encode in reserved field
//     const reserved = secretHandler.encodeKeyPart(
//         keyPart,
//         partNum,
//         session.startWindow
//     );
    
//     console.log(`   📦 Reserved field: 0x${reserved.toString(16)}`);
    
//     const filePath = path.join(__dirname, 'images', filename);
    
//     fs.readFile(filePath, (err, data) => {
//         if (err) {
//             console.log(`   ❌ Error reading file: ${err.message}`);
//             sendNotFound(sock);
//             return;
//         }
        
//         let seqNum = singleton.getSequenceNumber();
        
//         MTPpacket.init(1, seqNum, reserved, 1, data);
//         var packet = MTPpacket.getBytePacket();
//         sock.write(packet);
        
//         console.log(`   📤 Packet reserved bytes: ${packet[4].toString(16)} ${packet[5].toString(16)} ${packet[6].toString(16)} ${packet[7].toString(16)}`);
//         console.log(`   ✅ Sent ${filename} (${data.length} bytes) with key part ${partNum}`);
        
//         // 🔴 MARK THIS FILE AS SENT
//         session.fileSent[fileIndex] = true;
        
//         // Update session state
//         session.awaitingAck = true;
//         session.lastKeyPartNum = partNum;
//         session.keyParts[fileIndex] = keyPart;
        
//         // Set timeout for ACK
//         if (session.ackTimeout) {
//             clearTimeout(session.ackTimeout);
//         }
        
//         session.ackTimeout = setTimeout(() => {
//             if (session.awaitingAck && session.lastKeyPartNum === partNum) {
//                 console.log(`   ⏰ ACK timeout for client ${sock.remotePort}, part ${partNum}`);
//                 sendError(sock, "ACK timeout - session reset");
//                 clientSession.secretSession = null;
//             }
//         }, 30000);
//     });
// }

function sendFileWithKeyPart(sock, filename, clientSession) {
    const session = clientSession.secretSession;
    const fileIndex = session.nextFileIndex;
    const partNum = fileIndex + 1; // 1, 2, or 3

    // if (!session || !session.awaitingQuery) {
    //     console.log(`   ⚠️ Preventing automatic resend of ${filename}`);
    //     return;
    // }

    // 🔴 GUARD 1: Check if this file should be sent now
    if (filename !== session.expectedFiles[fileIndex]) {
        console.log(`   ⚠️ Not sending ${filename} - not the current expected file`);
        return;
    }
    
    // 🔴 GUARD 2: Check if this file was already sent
    // if (session.fileSent[fileIndex]) {
    //     console.log(`   ⚠️ File ${filename} already sent, ignoring duplicate call`);
    //     return;
    // }
    
    // Split the key and get the right part
    const keyParts = secretHandler.splitKey(session.variant.key);
    const keyPart = keyParts[fileIndex];
    
    console.log(`   🔑 Sending key part ${partNum}/3: "${keyPart}"`);
    
    // Encode in reserved field
    const reserved = secretHandler.encodeKeyPart(
        keyPart,
        partNum,
        session.startWindow
    );

    console.log(`   📦 Reserved field: 0x${reserved.toString(16)}`);
    
    // Path to the file
    const filePath = path.join(__dirname, 'images', filename);
    
    // Read and send the file
    fs.readFile(filePath, (err, data) => {
        if (err) {
            console.log(`   ❌ Error reading file: ${err.message}`);
            sendNotFound(sock);
            return;
        }
        
        // Get sequence number
        let seqNum = singleton.getSequenceNumber();
        
        // Send MTP packet with key part in reserved field
        // type=1 (Found), seqNum, reserved, lastFlag=1, payload=data
        MTPpacket.init(1, seqNum, reserved, 1, data);
        var packet = MTPpacket.getBytePacket();
        sock.write(packet);
        console.log(`   📤 Packet reserved bytes: ${packet[4].toString(16)} ${packet[5].toString(16)} ${packet[6].toString(16)} ${packet[7].toString(16)}`);
        console.log(`   ✅ Sent ${filename} (${data.length} bytes) with key part ${partNum}`);
        // prints til here
        // Update session state - now waiting for ACK
        session.awaitingAck = true;
        session.lastKeyPartNum = partNum;
        session.keyParts[fileIndex] = keyPart;
        
        // Set timeout for ACK (30 seconds)
        if (session.ackTimeout) {
            clearTimeout(session.ackTimeout);
        }
        
        session.ackTimeout = setTimeout(() => {
            if (session.awaitingAck && session.lastKeyPartNum === partNum) {
                console.log(`   ⏰ ACK timeout for client ${sock.remotePort}, part ${partNum}`);
                sendError(sock, "ACK timeout - session reset");
                clientSession.secretSession = null;
            }
        }, 30000);
    });
}

// Rename your existing sendFile to sendNormalFile for clarity
function sendNormalFile(sock, filePath, displayName) {
    fs.readFile(filePath, (err, data) => {
        if (err) {
            console.log(`   Error reading file: ${err.message}`);
            sendNotFound(sock);
            return;
        }
        
        let seqNum = singleton.getSequenceNumber();
        MTPpacket.init(1, seqNum, 0, 1, data);
        sock.write(MTPpacket.getBytePacket());
        
        console.log(`   ✅ Sent ${displayName} (${data.length} bytes)`);
    });
}

function handleSecret(sock, clientId) {
    const clientSession = clientSessions[clientId];
    console.log(`\n🔐 Secret request from client ${sock.remotePort}`);
    
    // ===== STEP 1: Get current variant from SecretHandler =====
    const variant = secretHandler.getCurrentVariant();
    
    // console.log(`   📊 Current time window: ${variant.windowId}`);
    // console.log(`   🆔 Variant ID: ${variant.id}`);
    // console.log(`   🔑 Key: ${variant.key}`);
    console.log(`${variant.riddle}`);
    // console.log(`   📁 File sequence: ${variant.fileSequence.join(' → ')}`);
    
    // ===== STEP 2: Create session in clientSession =====
    clientSession.secretSession = {
        // Window information
        startWindow: variant.windowId,
        
        // Variant information (the actual secret data)
        variant: variant,
        
        // File sequence (what files to request in order)
        expectedFiles: variant.fileSequence,
        
        // Progress tracking
        nextFileIndex: 0,           // 0 = first file, 1 = second, 2 = third
        keyParts: [],                // Store collected key parts
        keyPartsReceived: 0,         // Count of ACKed parts
        
        // ACK management
        awaitingAck: false,          // Waiting for client ACK?
        lastKeyPartNum: null,        // Which part was just sent
        
        // Completion status
        complete: false,             // All 3 parts received?
        
        // Timeout for ACK (set later when sending files)
        ackTimeout: null
    };
    
    console.log(`   ✅ Secret session created for client ${sock.remotePort}`);
    console.log(`   📍 Current state: waiting for file #1 (${variant.fileSequence[0]})`);
    
    // ===== STEP 3: Send riddle to client =====
    sendRiddle(sock, variant.riddle);
}

function handleAck(sock, clientId) {
    const clientSession = clientSessions[clientId];
    console.log(`\n✅ ACK request from client ${sock.remotePort}`);
    
    const session = clientSession.secretSession;
    
    // Check if session exists
    if (!session) {
        console.log(`   ❌ No active session`);
        sendError(sock, "No active secret session");
        return;
    }
    
    // Check if we're actually waiting for an ACK
    if (!session.awaitingAck) {
        console.log(`   ❌ Unexpected ACK (not waiting for one)`);
        sendError(sock, "Unexpected ACK");
        return;
    }
    
    // In a real implementation, you'd decode the reserved field
    // to verify which part is being acknowledged
    // For now, assume it's correct
    
    console.log(`   ✅ ACK received for part ${session.lastKeyPartNum}`);
    
    // Clear timeout
    if (session.ackTimeout) {
        clearTimeout(session.ackTimeout);
        session.ackTimeout = null;
    }
    
    // Update session
    session.awaitingAck = false;
    session.keyPartsReceived++;
    session.nextFileIndex++;
    
    console.log(`   📍 Progress: ${session.keyPartsReceived}/3 key parts received`);
    
    // Check if all key parts received
    if (session.keyPartsReceived >= 3) {
        session.complete = true;
        console.log(`   🎉 All 3 key parts collected! Ready for COMPLETE request`);
    } else {
        console.log(`   👉 Next file: ${session.expectedFiles[session.nextFileIndex]}`);
    }
    
    // Optional: Send ACK confirmation
    // let seqNum = singleton.getSequenceNumber();
    // let confirmMsg = Buffer.from(`ACK received for part ${session.lastKeyPartNum}`);
    // MTPpacket.init(1, seqNum, 0, 1, confirmMsg);
    // sock.write(MTPpacket.getBytePacket());
}

function sendError(sock, message) {
    let seqNum = singleton.getSequenceNumber();
    let errorData = Buffer.from(message);
    
    // Use type=2 (Not Found) with error message in payload
    // Parameters: init(res_type, seq_num, reserved, flag, data)
    MTPpacket.init(2, seqNum, 0, 1, errorData);
    sock.write(MTPpacket.getBytePacket());
    
    console.log(`   ⚠️ Error sent to client ${sock.remotePort}: "${message}"`);
}

function handleComplete(sock, clientId) {
    const clientSession = clientSessions[clientId];
    console.log(`\n📦 COMPLETE request from client ${sock.remotePort}`);
    
    const session = clientSession.secretSession;
    
    // Check if session exists
    if (!session) {
        console.log(`   ❌ No active session`);
        sendError(sock, "No active secret session");
        return;
    }
    
    // Check if all key parts have been collected
    if (!session.complete) {
        console.log(`   ❌ Session not complete (${session.keyPartsReceived}/3 parts)`);
        sendError(sock, `Secret session not complete. ${session.keyPartsReceived}/3 parts received.`);
        return;
    }
    
    // Check window validity
    if (!secretHandler.isWindowValid(session.startWindow)) {
        console.log(`   ❌ Session expired - window changed`);
        sendError(sock, "Session expired - time window changed");
        clientSession.secretSession = null;
        return;
    }
    
    console.log(`   ✅ All checks passed. Sending secret file...`);
    console.log(`   📁 Secret file: ${session.variant.secretFile}`);
    
    // Path to the secret file
    const secretPath = path.join(__dirname, 'images', session.variant.secretFile);
    
    // Read and send the secret file
    fs.readFile(secretPath, (err, data) => {
        if (err) {
            console.log(`   ❌ Error reading secret file: ${err.message}`);
            sendNotFound(sock);
            return;
        }
        
        let seqNum = singleton.getSequenceNumber();
        
        // Send the encrypted secret file
        // type=1 (Found), seqNum, reserved=windowId (optional), lastFlag=1, payload=data
        MTPpacket.init(1, seqNum, session.startWindow, 1, data);
        sock.write(MTPpacket.getBytePacket());
        
        console.log(`   ✅ Secret file sent (${data.length} bytes)`);
        console.log(`   🔒 Client must decrypt with reconstructed key`);
        
        // Session complete - clean up
        clientSession.secretSession = null;
    });
}

function handleReset(sock, clientId) {
    const clientSession = clientSessions[clientId];
    console.log(`\n🔄 RESET request from client ${sock.remotePort}`);
    
    // Clear any existing session
    if (clientSession.secretSession) {
        // Clear any pending timeout
        if (clientSession.secretSession.ackTimeout) {
            clearTimeout(clientSession.secretSession.ackTimeout);
        }
        
        console.log(`   ✅ Session cleared`);
        clientSession.secretSession = null;
    } else {
        console.log(`   ℹ️ No active session to reset`);
    }
    
    // Send confirmation
    let seqNum = singleton.getSequenceNumber();
    let confirmMsg = Buffer.from("Session reset successfully");
    MTPpacket.init(1, seqNum, 0, 1, confirmMsg);
    sock.write(MTPpacket.getBytePacket());
    
    console.log(`   ✅ Reset confirmation sent`);
}

// Helper function for sending riddles
function sendRiddle(sock, riddleText) {
    let seqNum = singleton.getSequenceNumber();
    let riddleData = Buffer.from(riddleText);
    
    MTPpacket.init(1, seqNum, 0, 1, riddleData);
    sock.write(MTPpacket.getBytePacket());
    
    console.log(`   📤 Riddle sent (${riddleData.length} bytes)`);
}

function sendNotFound(sock) {
    // Get next sequence number from singleton
    let seqNum = singleton.getSequenceNumber();
    
    // Create "Not Found" response (type=2) with empty payload
    MTPpacket.init(2, seqNum, 0, 1, Buffer.alloc(0));
    
    // Get the complete packet and send
    let packet = MTPpacket.getBytePacket();
    sock.write(packet);
    
    console.log(`Sent Not Found to client (sequence ${seqNum})`);
    
    // Optional: print packet for debugging
    // MTPpacket.printPacket();
}

function sendFile(sock, filePath, filename) {
    // Read the file
    fs.readFile(filePath, (err, data) => {
        if (err) {
            console.log(`Error reading file: ${err.message}`);
            sendNotFound(sock);
            return;
        }
        
        // Check if file is small enough for one packet
        // For now, assume single packet (we'll add multi-packet later)
        
        // Get next sequence number from singleton
        let seqNum = singleton.getSequenceNumber();
        
        // Create "Found" response (type=1) with file data as payload
        MTPpacket.init(1, seqNum, 0, 1, data);
        
        // Get packet and send
        let packet = MTPpacket.getBytePacket();
        sock.write(packet);
        
        console.log(`Sent file ${filename} (sequence ${seqNum}, ${data.length} bytes)`);
        
    });
}

function bytesToString(array) {
  var result = "";
  for (var i = 0; i < array.length; ++i) {
    result += String.fromCharCode(array[i]);
  }
  return result;
}

function bytes2number(array) {
  var result = "";
  for (var i = 0; i < array.length; ++i) {
    result ^= array[array.length - i - 1] << (8 * i);
  }
  return result;
}

// return integer value of a subset bits
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
