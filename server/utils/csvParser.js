const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const REQUIRED_HEADERS = ['recipient_email', 'subject', 'body'];
const OPTIONAL_HEADERS = ['first_name', 'last_name'];
const ALL_HEADERS = [...REQUIRED_HEADERS, ...OPTIONAL_HEADERS];

/**
 * Parse a CSV or XLSX file and extract leads
 * @param {string} filePath - path to the uploaded file on disk
 * @param {string} originalFilename - original name of the file
 * @returns {Object} - { success, leads, errors, totalRows }
 */
function parseLeadFile(filePath, originalFilename) {
  try {
    const fileToExt = originalFilename || filePath;
    const ext = path.extname(fileToExt).toLowerCase();
    if (!['.csv', '.xlsx', '.xls'].includes(ext)) {
      return { success: false, errors: ['Unsupported file format. Please upload .csv, .xlsx, or .xls'] };
    }

    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rawData = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    if (rawData.length === 0) {
      return { success: false, errors: ['File is empty or has no data rows'] };
    }

    // Validate headers
    const fileHeaders = Object.keys(rawData[0]).map(h => h.trim().toLowerCase());
    const missingHeaders = REQUIRED_HEADERS.filter(h => !fileHeaders.includes(h));

    if (missingHeaders.length > 0) {
      return {
        success: false,
        errors: [`Missing required columns: ${missingHeaders.join(', ')}. Required headers: ${REQUIRED_HEADERS.join(', ')}`],
      };
    }

    // Parse and validate rows
    const leads = [];
    const errors = [];

    rawData.forEach((row, index) => {
      // Normalize header keys
      const normalizedRow = {};
      Object.keys(row).forEach(key => {
        normalizedRow[key.trim().toLowerCase()] = String(row[key]).trim();
      });

      const lead = {
        recipient_email: normalizedRow.recipient_email || '',
        first_name: normalizedRow.first_name || '',
        last_name: normalizedRow.last_name || '',
        subject: normalizedRow.subject || '',
        body: normalizedRow.body || '',
      };

      // Validate email
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(lead.recipient_email)) {
        errors.push(`Row ${index + 2}: Invalid email "${lead.recipient_email}"`);
        return;
      }

      // Validate subject and body
      if (!lead.subject) {
        errors.push(`Row ${index + 2}: Missing subject`);
        return;
      }
      if (!lead.body) {
        errors.push(`Row ${index + 2}: Missing body`);
        return;
      }

      leads.push(lead);
    });

    // Clean up the uploaded file
    try { fs.unlinkSync(filePath); } catch (e) { /* ignore cleanup errors */ }

    return {
      success: true,
      leads,
      errors,
      totalRows: rawData.length,
      validRows: leads.length,
      invalidRows: errors.length,
    };
  } catch (error) {
    return { success: false, errors: [`Failed to parse file: ${error.message}`] };
  }
}

module.exports = { parseLeadFile, REQUIRED_HEADERS, ALL_HEADERS };
