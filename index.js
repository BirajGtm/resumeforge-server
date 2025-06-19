// server/index.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const puppeteer = require('puppeteer');
const MarkdownIt = require('markdown-it');
const fs = require('fs'); // To read the CSS file

const authMiddleware = require('./authMiddleware');
let serviceAccount;
serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);


// --- INITIALIZATION ---
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
const md = new MarkdownIt();
const app = express();
const PORT = process.env.PORT || 5001;

// --- MIDDLEWARE ---
const corsOptions = {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173'
};
app.use(cors(corsOptions));
app.use(express.json());

// --- ROUTES ---
app.get('/', (req, res) => {
  res.status(200).json({
    message: 'Welcome to the ResumeForge API!',
    status: 'Service is running',
    timestamp: new Date().toISOString(),
    documentation: 'For API usage, please refer to the project documentation.'
  });
});
// === DOCUMENT CRUD ROUTES ===

// GET all documents for the logged-in user
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

// POST a new document
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

// PUT (Update) a specific document
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

        // Security check: ensure the user owns this document
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


// DELETE a specific document
app.delete('/api/documents/:id', authMiddleware, async (req, res) => {
  try {
    const { uid } = req.user;
    const docId = req.params.id;

    const docRef = db.collection('documents').doc(docId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).send({ message: 'Document not found.' });
    }

    // Security check: ensure the user owns this document
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


// === PDF GENERATION ROUTE ===

app.post('/api/generate-pdf', authMiddleware, async (req, res) => {
  try {
    const { markdownContent, filename } = req.body;
    if (!markdownContent) {
        return res.status(400).send({ message: 'Markdown content is required.' });
    }

    const htmlContent = md.render(markdownContent);
    const pdfStyles = fs.readFileSync('./pdf-styles.css', 'utf8');

    const fullHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>${pdfStyles}</style>
        </head>
        <body>
          <!-- Add the wrapper div with the required class -->
          <div class="resume-preview">
            ${htmlContent}
          </div>
        </body>
      </html>
    `;
    
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    
    await page.setContent(fullHtml, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
    
    await browser.close();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${filename || 'document.pdf'}`);
    res.send(pdfBuffer);

  } catch (error) {
    console.error('Error generating PDF:', error);
    res.status(500).send({ message: 'Error generating PDF.' });
  }
});

// --- SERVER LISTENER ---
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});