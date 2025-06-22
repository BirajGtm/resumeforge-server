// server/index.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const fs = require('fs');
const MarkdownIt = require('markdown-it');
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
  process.env.FRONTEND_URL,
  'http://localhost:5173'
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
    documentation: 'For API usage, please refer to the project documentation.'
  });
});
app.get('/api/documents', authMiddleware, async (req, res) => {
  try {
    const { uid } = req.user;
    const documentsSnapshot = await db.collection('documents').where('userId', '==', uid).get();
    const documents = documentsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));
    res.status(200).json(documents);
  } catch (error) {
    console.error('Error fetching documents:', error);
    res.status(500).send({ message: 'Error fetching documents' });
  }
});
app.post('/api/documents', authMiddleware, async (req, res) => {
  try {
    const { uid } = req.user;
    const { companyName, positionName, resumeMarkdown, coverLetterMarkdown } = req.body;
    const newDoc = {
      userId: uid,
      companyName,
      positionName,
      resumeMarkdown,
      coverLetterMarkdown,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    const docRef = await db.collection('documents').add(newDoc);
    res.status(201).json({ id: docRef.id, ...newDoc });
  } catch (error) {
    console.error('Error creating document:', error);
    res.status(500).send({ message: 'Error creating document' });
  }
});
app.put('/api/documents/:id', authMiddleware, async (req, res) => {
    try {
        const { uid } = req.user;
        const docId = req.params.id;
        const data = req.body;
        const docRef = db.collection('documents').doc(docId);
        const doc = await docRef.get();
        if (!doc.exists) {
            return res.status(404).send({ message: 'Document not found.' });
        }
        if (doc.data().userId !== uid) {
            return res.status(403).send({ message: 'Forbidden: You do not own this document.' });
        }
        await docRef.update(data);
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
      disableSmartShrinking: true, // Prevents inconsistent font sizes
      enableLocalFileAccess: true, // Important for security and finding local assets
    }).pipe(res);

  } catch (error) {
    console.error('Error generating PDF:', error);
    res.status(500).send({ message: 'Error generating PDF.' });
  }
});

// --- CHANGE 4: The server startup is now much simpler ---
app.listen(PORT, () => {
  console.log(`Server is listening on http://localhost:${PORT}`);
});