// Invoice template
export const templates: Record<string, (data: Record<string, string>) => string> = {
  invoice: (data) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; margin: 40px; color: #333; }
    .header { display: flex; justify-content: space-between; margin-bottom: 40px; }
    .company-info { font-size: 14px; }
    .invoice-info { text-align: right; }
    .invoice-title { font-size: 28px; color: #2c3e50; margin-bottom: 10px; }
    .invoice-number { font-size: 14px; color: #7f8c8d; }
    .addresses { display: flex; justify-content: space-between; margin-bottom: 40px; }
    .address-block { width: 45%; }
    .address-label { font-weight: bold; color: #2c3e50; margin-bottom: 10px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
    th { background: #2c3e50; color: white; padding: 12px; text-align: left; }
    td { padding: 12px; border-bottom: 1px solid #ddd; }
    .totals { text-align: right; }
    .totals table { width: 300px; margin-left: auto; }
    .totals td { border: none; padding: 8px; }
    .total-row { font-weight: bold; font-size: 18px; background: #f8f9fa; }
    .notes { margin-top: 40px; padding: 20px; background: #f8f9fa; border-radius: 4px; }
    .footer { margin-top: 40px; text-align: center; font-size: 12px; color: #7f8c8d; }
  </style>
</head>
<body>
  <div class="header">
    <div class="company-info">
      <h2>${data.companyName || 'Company Name'}</h2>
      <p>${data.companyAddress || ''}<br>
      ${data.companyCity || ''}, ${data.companyState || ''} ${data.companyZip || ''}<br>
      ${data.companyPhone || ''}</p>
    </div>
    <div class="invoice-info">
      <div class="invoice-title">INVOICE</div>
      <div class="invoice-number">#${data.invoiceNumber || 'INV-001'}</div>
      <p>Date: ${data.invoiceDate || new Date().toLocaleDateString()}<br>
      Due: ${data.dueDate || ''}</p>
    </div>
  </div>

  <div class="addresses">
    <div class="address-block">
      <div class="address-label">Bill To:</div>
      <p>${data.clientName || 'Client Name'}<br>
      ${data.clientAddress || ''}<br>
      ${data.clientCity || ''}, ${data.clientState || ''} ${data.clientZip || ''}</p>
    </div>
    <div class="address-block">
      <div class="address-label">Payment Details:</div>
      <p>Terms: ${data.paymentTerms || 'Net 30'}<br>
      Method: ${data.paymentMethod || 'Bank Transfer'}</p>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Description</th>
        <th>Qty</th>
        <th>Rate</th>
        <th>Amount</th>
      </tr>
    </thead>
    <tbody>
      ${data.items || '<tr><td>Service</td><td>1</td><td>$0</td><td>$0</td></tr>'}
    </tbody>
  </table>

  <div class="totals">
    <table>
      <tr><td>Subtotal:</td><td>${data.subtotal || '$0'}</td></tr>
      <tr><td>Tax (${data.taxRate || '0'}%):</td><td>${data.tax || '$0'}</td></tr>
      <tr class="total-row"><td>Total:</td><td>${data.total || '$0'}</td></tr>
    </table>
  </div>

  ${data.notes ? `<div class="notes"><strong>Notes:</strong><br>${data.notes}</div>` : ''}

  <div class="footer">Thank you for your business!</div>
</body>
</html>`,

  report: (data) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Georgia, serif; margin: 40px; color: #333; line-height: 1.6; }
    .title-page { text-align: center; margin-bottom: 60px; padding-top: 100px; }
    .title { font-size: 36px; color: #2c3e50; margin-bottom: 10px; }
    .subtitle { font-size: 20px; color: #7f8c8d; margin-bottom: 40px; }
    .meta { font-size: 14px; color: #95a5a6; }
    h2 { color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 10px; margin-top: 40px; }
    .executive-summary { background: #f8f9fa; padding: 20px; border-left: 4px solid #3498db; margin: 30px 0; }
    .section { margin-bottom: 30px; }
    .conclusion { background: #e8f4f8; padding: 20px; border-radius: 4px; margin-top: 40px; }
    .footer { margin-top: 60px; text-align: center; font-size: 12px; color: #7f8c8d; border-top: 1px solid #ddd; padding-top: 20px; }
  </style>
</head>
<body>
  <div class="title-page">
    <div class="title">${data.title || 'Report Title'}</div>
    <div class="subtitle">${data.subtitle || ''}</div>
    <div class="meta">
      <p>Date: ${data.reportDate || new Date().toLocaleDateString()}</p>
      <p>Author: ${data.author || ''}</p>
    </div>
  </div>

  <div class="executive-summary">
    <h2>Executive Summary</h2>
    <p>${data.executiveSummary || ''}</p>
  </div>

  <div class="section">
    <h2>${data.section1Title || 'Introduction'}</h2>
    <p>${data.section1Content || ''}</p>
  </div>

  <div class="section">
    <h2>${data.section2Title || 'Analysis'}</h2>
    <p>${data.section2Content || ''}</p>
  </div>

  <div class="conclusion">
    <h2>Conclusion</h2>
    <p>${data.conclusion || ''}</p>
  </div>

  <div class="footer">
    <p>${data.companyName || ''} | ${data.companyContact || ''}</p>
  </div>
</body>
</html>`,

  resume: (data) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: 'Helvetica Neue', Arial, sans-serif; margin: 40px; color: #333; line-height: 1.5; }
    .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #2c3e50; padding-bottom: 20px; }
    .name { font-size: 32px; color: #2c3e50; margin-bottom: 10px; }
    .contact { font-size: 14px; color: #7f8c8d; }
    .contact a { color: #3498db; text-decoration: none; }
    h2 { color: #2c3e50; font-size: 16px; text-transform: uppercase; letter-spacing: 1px; margin-top: 25px; border-bottom: 1px solid #ddd; padding-bottom: 5px; }
    .summary { font-style: italic; color: #555; margin-bottom: 20px; }
    .experience-item, .education-item { margin-bottom: 20px; }
    .job-title { font-weight: bold; }
    .company { color: #3498db; }
    .date { font-size: 12px; color: #7f8c8d; float: right; }
    .skills { display: flex; flex-wrap: wrap; gap: 8px; }
    .skill-tag { background: #e8f4f8; color: #2c3e50; padding: 4px 12px; border-radius: 15px; font-size: 12px; }
  </style>
</head>
<body>
  <div class="header">
    <div class="name">${data.name || 'Your Name'}</div>
    <div class="contact">
      ${data.email || ''} | ${data.phone || ''} | ${data.location || ''}<br>
      ${data.linkedin ? `<a href="${data.linkedin}">${data.linkedin}</a>` : ''}
      ${data.website ? `| <a href="${data.website}">${data.website}</a>` : ''}
    </div>
  </div>

  <h2>Professional Summary</h2>
  <p class="summary">${data.summary || ''}</p>

  <h2>Experience</h2>
  ${data.experience || '<div class="experience-item"><span class="job-title">Position</span> at <span class="company">Company</span></div>'}

  <h2>Education</h2>
  ${data.education || '<div class="education-item">Degree - Institution</div>'}

  <h2>Skills</h2>
  <div class="skills">
    ${data.skills || '<span class="skill-tag">Skill</span>'}
  </div>
</body>
</html>`,

  letter: (data) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: 'Times New Roman', serif; margin: 60px; color: #333; line-height: 1.8; font-size: 14px; }
    .sender-info { margin-bottom: 40px; }
    .date { margin-bottom: 40px; }
    .recipient-info { margin-bottom: 40px; }
    .body { margin-bottom: 40px; text-align: justify; }
    .closing { margin-top: 40px; }
    .signature { margin-top: 60px; }
  </style>
</head>
<body>
  <div class="sender-info">
    <strong>${data.senderName || ''}</strong><br>
    ${data.senderAddress || ''}<br>
    ${data.senderCity || ''}, ${data.senderState || ''} ${data.senderZip || ''}
  </div>

  <div class="date">${data.date || new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>

  <div class="recipient-info">
    ${data.recipientName || ''}<br>
    ${data.recipientTitle ? data.recipientTitle + '<br>' : ''}
    ${data.recipientCompany ? data.recipientCompany + '<br>' : ''}
    ${data.recipientAddress || ''}<br>
    ${data.recipientCity || ''}, ${data.recipientState || ''} ${data.recipientZip || ''}
  </div>

  <div class="body">
    <p>Dear ${data.recipientName || 'Sir/Madam'},</p>
    <p>${data.body || ''}</p>
  </div>

  <div class="closing">
    ${data.closing || 'Sincerely'},
  </div>

  <div class="signature">
    ${data.senderName || ''}
  </div>
</body>
</html>`,

  contract: (data) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: 'Times New Roman', serif; margin: 50px; color: #333; line-height: 1.6; font-size: 12px; }
    .title { text-align: center; font-size: 24px; font-weight: bold; margin-bottom: 30px; text-transform: uppercase; }
    .date { text-align: center; margin-bottom: 30px; }
    h2 { font-size: 14px; margin-top: 25px; }
    .parties { margin-bottom: 30px; }
    .section { margin-bottom: 20px; text-align: justify; }
    .signatures { margin-top: 60px; display: flex; justify-content: space-between; }
    .signature-block { width: 45%; }
    .signature-line { border-top: 1px solid #333; margin-top: 60px; padding-top: 10px; }
  </style>
</head>
<body>
  <div class="title">${data.contractTitle || 'SERVICE AGREEMENT'}</div>
  <div class="date">Effective Date: ${data.effectiveDate || new Date().toLocaleDateString()}</div>

  <div class="parties">
    <p>This Agreement is entered into by and between:</p>
    <p><strong>${data.party1Name || 'Party 1'}</strong> ("${data.party1Label || 'Provider'}")<br>
    Address: ${data.party1Address || ''}</p>
    <p>AND</p>
    <p><strong>${data.party2Name || 'Party 2'}</strong> ("${data.party2Label || 'Client'}")<br>
    Address: ${data.party2Address || ''}</p>
  </div>

  <div class="section">
    <h2>1. PURPOSE</h2>
    <p>${data.purpose || ''}</p>
  </div>

  <div class="section">
    <h2>2. TERM</h2>
    <p>This Agreement shall be effective for a period of ${data.term || '12 months'} from the Effective Date.</p>
  </div>

  <div class="section">
    <h2>3. OBLIGATIONS</h2>
    <p>${data.obligations || ''}</p>
  </div>

  <div class="section">
    <h2>4. COMPENSATION</h2>
    <p>${data.compensation || ''}</p>
  </div>

  <div class="section">
    <h2>5. TERMINATION</h2>
    <p>${data.termination || ''}</p>
  </div>

  <div class="section">
    <h2>6. GOVERNING LAW</h2>
    <p>This Agreement shall be governed by the laws of ${data.governingLaw || 'the applicable jurisdiction'}.</p>
  </div>

  <div class="signatures">
    <div class="signature-block">
      <div class="signature-line">
        ${data.party1Name || 'Party 1'}<br>
        ${data.party1Label || 'Provider'}
      </div>
    </div>
    <div class="signature-block">
      <div class="signature-line">
        ${data.party2Name || 'Party 2'}<br>
        ${data.party2Label || 'Client'}
      </div>
    </div>
  </div>
</body>
</html>`
};
