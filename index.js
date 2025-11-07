// server/index.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const fs = require('fs');
const MarkdownIt = require('markdown-it');
const crypto = require('crypto');
// --- CHANGE 1: Import the new, lightweight library ---
const wkhtmltopdf = require('wkhtmltopdf');

const authMiddleware = require('./authMiddleware');

// --- Initialization ---
let serviceAccount;
// The 'if/else' for local vs. deployed service account is good practice, I've restored it.
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} else {
  // This allows you to run the server locally with a file
  serviceAccount = require('./serviceAccountKey.json');
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
const md = new MarkdownIt();
const app = express();
const PORT = process.env.PORT || 5001;

// --- Middleware ---
const allowedOrigins = [
  "https://resume-forge-app.netlify.app",
  'http://localhost:5173',
  'https://resume.birajgautam.com.np',
];
const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
};
app.use(cors(corsOptions));
app.use(express.json({ limit: '5mb' }));

// --- CHANGE 2: The entire browser section is GONE ---
// No more global browserInstance variable.
// No more startBrowser function.

// --- ROUTES ---
// Your existing CRUD routes for documents do not need any changes.
app.get('/', (req, res) => {
  res.status(200).json({
    message: 'Welcome to the ResumeForge API!',
    status: 'Service is running',
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/documents', authMiddleware, async (req, res) => {
  try {
    const { uid } = req.user;
    const { fields, status } = req.query;
    
    let query = db.collection('documents').where('userId', '==', uid);

    // If a status filter is provided (and it's not 'All'), add it to the query
    if (status && status !== 'All') {
      query = query.where('status', '==', status);
    }
    const documentsSnapshot = await query.get();
    
    let documents;
    if (fields) {
      const requestedFields = fields.split(',');
      documents = documentsSnapshot.docs.map(doc => {
        const data = doc.data();
        const filteredDoc = { id: doc.id };
        requestedFields.forEach(field => {
          if (field !== 'id' && data.hasOwnProperty(field)) {
            filteredDoc[field] = data[field];
          }
        });
        return filteredDoc;
      });
    } else {
      documents = documentsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      }));
    }
    
    res.status(200).json(documents);
  } catch (error) {
    console.error('Error fetching documents:', error);
    res.status(500).send({ message: 'Error fetching documents' });
  }
});

app.get('/api/documents/:id', authMiddleware, async (req, res) => {
  try {
    const { uid } = req.user;
    const docId = req.params.id;

    const docRef = db.collection('documents').doc(docId);
    const doc = await docRef.get();

    if (!doc.exists) {
      // This is a valid case, but shouldn't happen in normal flow
      return res.status(404).send({ message: 'Document not found.' });
    }

    // Security check: ensure the user owns this document
    if (doc.data().userId !== uid) {
      return res.status(403).send({ message: 'Forbidden: You do not have permission to view this document.' });
    }

    // If everything is okay, send back the document data
    res.status(200).json({ id: doc.id, ...doc.data() });

  } catch (error) {
    console.error('Error fetching single document:', error);
    res.status(500).send({ message: 'Error fetching document.' });
  }
});

app.post('/api/documents', authMiddleware, async (req, res) => {
  try {
    const { uid } = req.user;
    const { companyName, positionName, resumeMarkdown, coverLetterMarkdown, status, notes } = req.body;
    const newDoc = {
      userId: uid,
      companyName,
      positionName,
      resumeMarkdown,
      coverLetterMarkdown,
      status: status || 'Draft',
      notes: notes || '',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    const docRef = await db.collection('documents').add(newDoc);
    res.status(201).json({ id: docRef.id, ...newDoc });
  } catch (error) {
    console.error('Error creating document:', error);
    res.status(500).send({ message: 'Error creating document' });
  }
});


// put document
app.put('/api/documents/:id', authMiddleware, async (req, res) => {
    try {
        const { uid } = req.user;
        const docId = req.params.id;
        
        const { companyName, positionName, resumeMarkdown, coverLetterMarkdown, status, notes } = req.body;
        const updatableData = {
            companyName,
            positionName,
            resumeMarkdown,
            coverLetterMarkdown,
            status,
            notes,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        const docRef = db.collection('documents').doc(docId);
        const doc = await docRef.get();

        if (!doc.exists) {
            return res.status(404).send({ message: 'Document not found.' });
        }
        if (doc.data().userId !== uid) {
            return res.status(403).send({ message: 'Forbidden: You do not own this document.' });
        }

        // Update with the sanitized, whitelisted data object
        await docRef.update(updatableData); 
        
        res.status(200).json({ message: 'Document updated successfully.' });
    } catch (error) {
        console.error('Error updating document:', error);
        res.status(500).send({ message: 'Error updating document.' });
    }
});

app.delete('/api/documents/:id', authMiddleware, async (req, res) => {
  try {
    const { uid } = req.user;
    const docId = req.params.id;
    const docRef = db.collection('documents').doc(docId);
    const doc = await docRef.get();
    if (!doc.exists) {
      return res.status(404).send({ message: 'Document not found.' });
    }
    if (doc.data().userId !== uid) {
      return res.status(403).send({ message: 'Forbidden: You do not own this document.' });
    }
    await docRef.delete();
    res.status(200).json({ message: 'Document deleted successfully.' });
  } catch (error) {
    console.error('Error deleting document:', error);
    res.status(500).send({ message: 'Error deleting document.' });
  }
});

// Add this new route in server/index.js, probably after your other PUT route.

// PUT (Update) a document's status
app.put('/api/documents/:id/status', authMiddleware, async (req, res) => {
    try {
        const { uid } = req.user;
        const docId = req.params.id;
        const { status } = req.body;

        // A list of allowed statuses to prevent invalid data
        const allowedStatuses = ['Draft', 'Applied', 'Interviewing', 'Offer', 'Rejected'];
        if (!status || !allowedStatuses.includes(status)) {
            return res.status(400).send({ message: 'Invalid status provided.' });
        }

        const docRef = db.collection('documents').doc(docId);
        const doc = await docRef.get();

        if (!doc.exists) {
            return res.status(404).send({ message: 'Document not found.' });
        }

        // Security check: ensure the user owns this document
        if (doc.data().userId !== uid) {
            return res.status(403).send({ message: 'Forbidden: You do not own this document.' });
        }

        // Update only the status field
        await docRef.update({ status });
        res.status(200).json({ message: `Document status updated to ${status}.` });

    } catch (error) {
        console.error('Error updating document status:', error);
        res.status(500).send({ message: 'Error updating document status.' });
    }
});

// === PDF GENERATION ROUTE (Refactored for wkhtmltopdf) ===
app.post('/api/generate-pdf', authMiddleware, (req, res) => {
  try {
    const { markdownContent, filename } = req.body;
    if (!markdownContent) {
      return res.status(400).send({ message: 'Markdown content is required.' });
    }

    const htmlContent = md.render(markdownContent);
    const pdfStyles = fs.readFileSync('./pdf-styles.css', 'utf8');
    const fullHtml = `
      <!DOCTYPE html><html><head><meta charset="utf-8"><style>${pdfStyles}</style></head>
      <body><div class="resume-preview">${htmlContent}</div></body></html>`;

    // --- CHANGE 3: The new, memory-efficient PDF generation ---
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${filename || 'document.pdf'}`);

    // Pipe the PDF output directly to the Express response stream
    wkhtmltopdf(fullHtml, {
  pageSize: 'A4',
  marginTop: '30px',
  marginRight: '30px',
  marginBottom: '30px',
  marginLeft: '30px',
  disableSmartShrinking: true
}).pipe(res);

  } catch (error) {
    console.error('Error generating PDF:', error);
    res.status(500).send({ message: 'Error generating PDF.' });
  }
});

// --- Sharing Routes ---
// Helper: fetch and validate shared document data by token
async function fetchSharedDocumentData(shareToken) {
  // Get share record
  const shareRef = db.collection('shares').doc(shareToken);
  const shareSnap = await shareRef.get();

  if (!shareSnap.exists) {
    const e = new Error('Share not found or has expired.');
    e.status = 404;
    throw e;
  }

  const shareData = shareSnap.data();

  // Check if share has expired
  if (shareData.expiresAt && shareData.expiresAt.toDate && shareData.expiresAt.toDate() < new Date()) {
    const e = new Error('This share has expired.');
    e.status = 410;
    throw e;
  }

  // Get original document
  const docRef = db.collection('documents').doc(shareData.documentId);
  const docSnap = await docRef.get();
  if (!docSnap.exists) {
    const e = new Error('Original document not found.');
    e.status = 404;
    throw e;
  }

  const documentData = docSnap.data();
  const response = {
    companyName: documentData.companyName,
    positionName: documentData.positionName,
    isEditable: !!shareData.isEditable // --- ADD THIS LINE ---
  };

  // Only include permitted sections based on share configuration
  if (shareData.config && shareData.config.resumeMarkdown) {
    response.resumeMarkdown = documentData.resumeMarkdown;
  }
  if (shareData.config && shareData.config.coverLetterMarkdown) {
    response.coverLetterMarkdown = documentData.coverLetterMarkdown;
  }
  if (shareData.config && shareData.config.notes) {
    response.notes = documentData.notes;
  }

  return response;
}

// Create or Update a share link for a document
app.post('/api/documents/:documentId/share', authMiddleware, async (req, res) => {
  try {
    const { uid } = req.user;
    const { documentId } = req.params;
    const { resumeMarkdown, coverLetterMarkdown, notes, isEditable } = req.body; 

    // Basic input validation
    const isBool = v => typeof v === 'boolean' || v === undefined || v === null;
    if (!isBool(resumeMarkdown) || !isBool(coverLetterMarkdown) || !isBool(notes) || !isBool(isEditable)) {
      return res.status(400).send({ message: 'Invalid share configuration. Expected boolean values.' });
    }

    // Verify document ownership
    const docRef = db.collection('documents').doc(documentId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).send({ message: 'Document not found.' });
    }

    if (doc.data().userId !== uid) {
      return res.status(403).send({ message: 'Forbidden: You do not own this document.' });
    }

    // --- UPSERT LOGIC ---
    // 1. Check if a share already exists for this documentId and user
    const sharesQuery = db.collection('shares')
      .where('documentId', '==', documentId)
      .where('createdBy', '==', uid)
      .limit(1);

    const sharesSnapshot = await sharesQuery.get();

    const newConfig = {
      resumeMarkdown: !!resumeMarkdown,
      coverLetterMarkdown: !!coverLetterMarkdown,
      notes: !!notes
    };

    if (!sharesSnapshot.empty) {
      // --- UPDATE (if exists) ---
      const existingShare = sharesSnapshot.docs[0];
      const shareRef = existingShare.ref;
      const newExpiresAt = admin.firestore.Timestamp.fromDate(
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days from now
      );

      await shareRef.update({
        config: newConfig,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt: newExpiresAt,
        isEditable: !!isEditable
      });

      const shareUrl = `/documents/share/${existingShare.id}`;
      res.status(200).json({ 
        shareUrl, message: 'Share link updated.', expiresAt: newExpiresAt.toDate().toISOString() 
      });

    } else {
      // --- CREATE (if not exists) ---
      // Simple rate limit for *new* creations: max 10 shares per user per hour
      const oneHourAgo = admin.firestore.Timestamp.fromDate(new Date(Date.now() - 60 * 60 * 1000));
      const recentSharesSnap = await db.collection('shares')
        .where('createdBy', '==', uid)
        .where('createdAt', '>=', oneHourAgo)
        .get();
      if (recentSharesSnap.size >= 10) {
        return res.status(429).send({ message: 'Rate limit exceeded: too many new share creations. Try again later.' });
      }

      const shareToken = crypto.randomBytes(32).toString('hex');
      const shareData = {
        documentId,
        config: newConfig,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdBy: uid,
        expiresAt: admin.firestore.Timestamp.fromDate(
          new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days from now
        ),
        isEditable: !!isEditable
      };

      await db.collection('shares').doc(shareToken).set(shareData);
      const shareUrl = `/documents/share/${shareToken}`;
      res.status(200).json({ 
        shareUrl, message: 'Share link created.', expiresAt: shareData.expiresAt.toDate().toISOString() 
      });
    }
  } catch (error) {
    console.error('Error creating share:', error);
    res.status(500).send({ message: 'Error creating share' });
  }
});

// Get the LATEST share for a document (for the share modal)
app.get('/api/documents/:documentId/share', authMiddleware, async (req, res) => {
  try {
    const { uid } = req.user;
    const { documentId } = req.params;

    // First, verify document ownership for security
    const docRef = db.collection('documents').doc(documentId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).send({ message: 'Document not found.' });
    }

    if (doc.data().userId !== uid) {
      return res.status(403).send({ message: 'Forbidden: You do not own this document.' });
    }

    // Find the most recent share for this document created by the user
    const sharesQuery = db.collection('shares')
      .where('documentId', '==', documentId)
      .where('createdBy', '==', uid)
      .orderBy('createdAt', 'desc')
      .limit(1);

    const sharesSnapshot = await sharesQuery.get();

    if (sharesSnapshot.empty) {
      // This is the expected case when no share has been created yet.
      return res.status(404).send({ message: 'No share link found for this document.' });
    }

    const latestShare = sharesSnapshot.docs[0];
    const shareData = latestShare.data();

    res.status(200).json({
      shareUrl: `/documents/share/${latestShare.id}`,
      shareConfig: shareData.config,
      expiresAt: shareData.expiresAt.toDate().toISOString()
    });
  } catch (error) {
    console.error('Error fetching latest share:', error);
    res.status(500).send({ message: 'Error fetching share information' });
  }
});

// Get all shares for a document
app.get('/api/documents/:documentId/shares', authMiddleware, async (req, res) => {
  try {
    const { uid } = req.user;
    const { documentId } = req.params;

    // Verify document ownership
    const docRef = db.collection('documents').doc(documentId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).send({ message: 'Document not found.' });
    }

    if (doc.data().userId !== uid) {
      return res.status(403).send({ message: 'Forbidden: You do not own this document.' });
    }

    // Get all shares for this document
    const sharesSnapshot = await db.collection('shares')
      .where('documentId', '==', documentId)
      .where('createdBy', '==', uid)
      .get();

    const shares = sharesSnapshot.docs.map(share => ({
      shareToken: share.id,
      ...share.data(),
      shareUrl: `${process.env.FRONTEND_URL || 'https://resume.birajgautam.com.np'}/shared/${share.id}`
    }));

    res.status(200).json(shares);
  } catch (error) {
    console.error('Error fetching shares:', error);
    res.status(500).send({ message: 'Error fetching shares' });
  }
});

// Delete a share
app.delete('/api/documents/:documentId/shares/:shareToken', authMiddleware, async (req, res) => {
  try {
    const { uid } = req.user;
    const { documentId, shareToken } = req.params;

    // Get the share
    const shareRef = db.collection('shares').doc(shareToken);
    const share = await shareRef.get();

    if (!share.exists) {
      return res.status(404).send({ message: 'Share not found.' });
    }

    // Verify ownership
    if (share.data().createdBy !== uid || share.data().documentId !== documentId) {
      return res.status(403).send({ message: 'Forbidden: You do not own this share.' });
    }

    // Delete the share
    await shareRef.delete();

    res.status(200).json({ message: 'Share deleted successfully.' });
  } catch (error) {
    console.error('Error deleting share:', error);
    res.status(500).send({ message: 'Error deleting share' });
  }
});

// --- NEW ---
// Public endpoint to UPDATE a shared document
app.put('/api/documents/share/:shareToken', async (req, res) => {
  try {
    const { shareToken } = req.params;
    const { resumeMarkdown, coverLetterMarkdown, notes } = req.body;

    // 1. Fetch the share record
    const shareRef = db.collection('shares').doc(shareToken);
    const shareSnap = await shareRef.get();

    if (!shareSnap.exists) {
      return res.status(404).send({ message: 'Share link not found or has expired.' });
    }

    const shareData = shareSnap.data();

    // 2. CRITICAL: Security check for editability
    if (!shareData.isEditable) {
      return res.status(403).send({ message: 'Forbidden: This document is not editable.' });
    }

    // 3. Check for expiration
    if (shareData.expiresAt && shareData.expiresAt.toDate() < new Date()) {
      return res.status(410).send({ message: 'This share link has expired.' });
    }

    // 4. Prepare the data to update, respecting the original share configuration
    const updatableData = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    if (shareData.config.resumeMarkdown && resumeMarkdown !== undefined) {
      updatableData.resumeMarkdown = resumeMarkdown;
    }
    if (shareData.config.coverLetterMarkdown && coverLetterMarkdown !== undefined) {
      updatableData.coverLetterMarkdown = coverLetterMarkdown;
    }
    if (shareData.config.notes && notes !== undefined) {
      updatableData.notes = notes;
    }

    // 5. Update the original document
    const docRef = db.collection('documents').doc(shareData.documentId);
    // We don't need to check if the doc exists here, as it's implied by the share's existence.
    // If it was deleted, the update will fail, which is correct.
    await docRef.update(updatableData);

    res.status(200).json({ message: 'Document updated successfully.' });

  } catch (error) {
    console.error('Error updating shared document:', error);
    res.status(500).send({ message: 'An error occurred while updating the document.' });
  }
});


// Public endpoint to view shared documents (frontend expects this path)
app.get('/api/documents/share/:shareToken', async (req, res) => {
  try {
    const { shareToken } = req.params;
    const response = await fetchSharedDocumentData(shareToken);
    res.status(200).json(response);
  } catch (error) {
    console.error('Error fetching shared document:', error);
    res.status(error.status || 500).send({ message: error.message || 'Error fetching shared document' });
  }
});

// --- NEW ---
// Public endpoint to DOWNLOAD a shared document as PDF
app.get('/api/documents/share/:shareToken/download', async (req, res) => {
  try {
    const { shareToken } = req.params;
    const { resume, cover_letter } = req.query; // Allow choosing which to download

    // 1. Fetch the shared data
    const sharedData = await fetchSharedDocumentData(shareToken);

    let markdownContent = '';
    const baseFilename = sharedData.companyName || 'document';
    let filename = `${baseFilename}.pdf`; // Default filename
    const hasResume = resume === 'true' && sharedData.resumeMarkdown;
    const hasCoverLetter = cover_letter === 'true' && sharedData.coverLetterMarkdown;

    // 2. Combine content based on query params
    if (hasResume) {
      markdownContent += sharedData.resumeMarkdown;
    }
    if (hasCoverLetter) {
      if (markdownContent) markdownContent += '\n\n---\n\n'; // Add separator
      markdownContent += sharedData.coverLetterMarkdown;
    }

    // Adjust filename based on content
    if (hasResume && hasCoverLetter) {
      filename = `${baseFilename}-application.pdf`;
    } else if (hasResume) {
      filename = `${baseFilename}-resume.pdf`;
    } else if (hasCoverLetter) {
      filename = `${baseFilename}-cover-letter.pdf`;
    }

    if (!markdownContent) {
      return res.status(400).send({ message: 'No content available to download for the selected options.' });
    }

    // 3. Generate PDF (similar to the authenticated route)
    const htmlContent = md.render(markdownContent);
    const pdfStyles = fs.readFileSync('./pdf-styles.css', 'utf8');
    const fullHtml = `
      <!DOCTYPE html><html><head><meta charset="utf-8"><style>${pdfStyles}</style></head>
      <body><div class="resume-preview">${htmlContent}</div></body></html>`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    wkhtmltopdf(fullHtml, {
      pageSize: 'A4',
      marginTop: '30px',
      marginRight: '30px',
      marginBottom: '30px',
      marginLeft: '30px',
      disableSmartShrinking: true
    }).pipe(res);

  } catch (error) {
    console.error('Error generating shared PDF:', error);
    res.status(error.status || 500).send({ message: error.message || 'Error generating shared PDF' });
  }
});


// --- CHANGE 4: The server startup is now much simpler ---
app.listen(PORT, () => {
  console.log(`Server is listening on http://localhost:${PORT}`);
});