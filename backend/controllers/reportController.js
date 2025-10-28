const Report = require('../models/reports');
const Goal = require('../models/Goal');
const IncomeExpense = require('../models/Income'); 
const Notification = require('../models/Notification');
const PDFDocument = require('pdfkit');

// ===========================
// 📊 GENERATE REPORT
// ===========================
exports.generateReport = async (req, res) => {
  try {
    const { reportType, startDate, endDate } = req.body;
    const userId = req.user._id || req.user.id;

    if (!reportType) {
      return res.status(400).json({ success: false, error: 'Please provide report type' });
    }

    const goals = await Goal.find({ user: userId });
    const incomeExpenseData = await IncomeExpense.findOne({ userId: userId });

    if (!incomeExpenseData) {
      return res.status(404).json({
        success: false,
        error: 'No income/expense data found. Please add your financial data first.'
      });
    }

    const reportData = await calculateReportData(userId, goals, incomeExpenseData);

    const report = await Report.create({
      user: userId,
      reportType,
      reportPeriod: {
        startDate: startDate || new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
        endDate: endDate || new Date()
      },
      reportData
    });

    await Notification.create({
      user: userId,
      type: 'report_generated',
      title: 'Report Generated',
      message: `Your ${reportType} report has been generated successfully!`,
      icon: '📊',
      priority: 'MEDIUM',
      isRead: false,
      relatedId: report._id,
      relatedType: 'Report',
      actionUrl: `/reports/${report._id}`
    });

    const populatedReport = await Report.findById(report._id).populate('user', 'name email');

    res.status(201).json({ success: true, data: populatedReport });
  } catch (error) {
    console.error('Error generating report:', error);
    res.status(500).json({ success: false, error: 'Failed to generate report', message: error.message });
  }
};

// ===========================
// 📄 GET ALL REPORTS
// ===========================
exports.getReports = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const reports = await Report.find({ user: userId }).sort('-createdAt');

    res.status(200).json({ success: true, count: reports.length, data: reports });
  } catch (error) {
    console.error('Error fetching reports:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch reports', message: error.message });
  }
};

// ===========================
// 📑 GET SINGLE REPORT
// ===========================
exports.getReport = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const report = await Report.findById(req.params.id).populate('user', 'name email');

    if (!report) return res.status(404).json({ success: false, error: 'Report not found' });
    if (report.user._id.toString() !== userId.toString())
      return res.status(403).json({ success: false, error: 'Not authorized' });

    res.status(200).json({ success: true, data: report });
  } catch (error) {
    console.error('Error fetching report:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch report', message: error.message });
  }
};

// ===========================
// 🧾 DOWNLOAD PDF
// ===========================
exports.downloadReportPDF = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const report = await Report.findById(req.params.id).populate('user', 'name email');

    if (!report) return res.status(404).json({ success: false, error: 'Report not found' });
    if (report.user._id.toString() !== userId.toString())
      return res.status(403).json({ success: false, error: 'Not authorized' });

    const doc = new PDFDocument({ margin: 50 });
    const fileName = `financial-report-${report.reportType.replace(/\s+/g, '-').toLowerCase()}-${Date.now()}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    doc.pipe(res);
    generatePDFContent(doc, report);
    doc.end();
  } catch (error) {
    console.error('Error downloading PDF:', error);
    res.status(500).json({ success: false, error: 'Failed to download PDF', message: error.message });
  }
};

// ===========================
// ❌ DELETE REPORT
// ===========================
exports.deleteReport = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const report = await Report.findById(req.params.id);
    if (!report) return res.status(404).json({ success: false, error: 'Report not found' });
    if (report.user.toString() !== userId.toString())
      return res.status(403).json({ success: false, error: 'Not authorized' });

    const reportType = report.reportType;
    await report.deleteOne();

    await Notification.create({
      user: userId,
      type: 'report_deleted',
      title: 'Report Deleted',
      message: `Report "${reportType}" has been deleted successfully`,
      icon: '🗑️',
      priority: 'LOW',
      isRead: false,
      relatedType: 'Report'
    });

    res.status(200).json({ success: true, message: 'Report deleted successfully' });
  } catch (error) {
    console.error('Error deleting report:', error);
    res.status(500).json({ success: false, error: 'Failed to delete report', message: error.message });
  }
};

// ===========================
// 📂 GET REPORTS BY TYPE
// ===========================
exports.getReportsByType = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const reports = await Report.find({ reportType: req.params.reportType, user: userId }).sort('-createdAt');
    res.status(200).json({ success: true, count: reports.length, data: reports });
  } catch (error) {
    console.error('Error fetching reports by type:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch reports', message: error.message });
  }
};

// ===========================
// 📊 HELPER FUNCTIONS
// ===========================
async function calculateReportData(userId, goals, incomeExpenseData) {
  const reportData = {
    summary: {},
    incomeBreakdown: {},
    expenseBreakdown: [],
    assetAllocation: {},
    loanSummary: {},
    goalProgress: [],
    healthIndicators: {},
    recommendations: []
  };

  // ✅ FIXED: Calculate total monthly income from incomes array
  const totalIncome = incomeExpenseData.totalMonthlyIncome || 
    incomeExpenseData.incomes.reduce((sum, inc) => sum + (inc.monthlyAmount || 0), 0);

  // ✅ FIXED: Calculate total monthly expenses from expenses array
  const totalExpenses = incomeExpenseData.totalMonthlyExpenses || 
    incomeExpenseData.expenses.reduce((sum, exp) => sum + (exp.monthlyAmount || 0), 0);

  // ✅ Calculate savings
  const monthlySavings = incomeExpenseData.monthlySavings || (totalIncome - totalExpenses);
  const savingsRate = totalIncome > 0 ? (monthlySavings / totalIncome) * 100 : 0;

  // ✅ Calculate total assets
  const totalAssets = incomeExpenseData.totalAssetValue || 
    incomeExpenseData.assets.reduce((sum, asset) => sum + (asset.currentValue || 0), 0);

  // ✅ Summary
  reportData.summary = {
    totalIncome,
    totalExpenses,
    totalAssets,
    totalLiabilities: 0, // Add loan calculation if you have loans
    netWorth: totalAssets, // Assets - Liabilities
    monthlySavings,
    savingsRate
  };

  // ✅ FIXED: Income Breakdown - group by source name
  reportData.incomeBreakdown = {};
  incomeExpenseData.incomes.forEach(income => {
    const key = income.name.toLowerCase().replace(/\s+/g, '');
    reportData.incomeBreakdown[key] = (reportData.incomeBreakdown[key] || 0) + income.monthlyAmount;
  });

  // ✅ FIXED: Expense Breakdown - with percentages
  reportData.expenseBreakdown = incomeExpenseData.expenses.map(expense => ({
    category: expense.category,
    amount: expense.monthlyAmount,
    percentage: totalExpenses > 0 ? (expense.monthlyAmount / totalExpenses) * 100 : 0
  }));

  // ✅ Asset Allocation
  reportData.assetAllocation = {
    mutualFunds: incomeExpenseData.assets
      .filter(a => a.type === 'MutualFund')
      .reduce((sum, a) => sum + a.currentValue, 0),
    insurance: 0, // Add if you have insurance data
    otherAssets: incomeExpenseData.assets
      .filter(a => a.type === 'Other' || a.type === 'Equity')
      .reduce((sum, a) => sum + a.currentValue, 0)
  };

  // ✅ Loan Summary (placeholder - add if you have loan data)
  reportData.loanSummary = {
    totalLoans: 0,
    totalOutstanding: 0,
    totalEMI: 0,
    loansByType: []
  };

  // ✅ Goals progress
  reportData.goalProgress = goals.map(goal => {
    const progressPercentage = goal.targetAmount ? (goal.currentAmount / goal.targetAmount) * 100 : 0;
    const monthsRemaining = goal.targetDate ? 
      Math.max(0, Math.ceil((new Date(goal.targetDate) - new Date()) / (1000 * 60 * 60 * 24 * 30))) : 0;
    
    let status = 'On Track';
    if (progressPercentage >= 100) status = 'Completed';
    else if (progressPercentage >= 80) status = 'Near Completion';
    else if (monthsRemaining < 6 && progressPercentage < 50) status = 'Behind';

    return {
      goalId: goal._id,
      goalName: goal.goalName,
      targetAmount: goal.targetAmount,
      currentAmount: goal.currentAmount,
      progressPercentage,
      monthsRemaining,
      status
    };
  });

  // ✅ Health Indicators
  reportData.healthIndicators = {
    debtToIncomeRatio: 0, // Calculate if you have loan data
    savingsToIncomeRatio: savingsRate,
    emergencyFundMonths: totalExpenses > 0 ? totalAssets / totalExpenses : 0,
    financialHealthScore: calculateHealthScore(savingsRate, totalAssets, totalExpenses)
  };

  // ✅ Recommendations
  reportData.recommendations = generateRecommendations(reportData);

  return reportData;
}

// Helper function to calculate health score
function calculateHealthScore(savingsRate, totalAssets, totalExpenses) {
  let score = 0;
  
  // Savings rate (40 points max)
  if (savingsRate >= 20) score += 40;
  else if (savingsRate >= 10) score += 30;
  else if (savingsRate >= 5) score += 20;
  else score += 10;
  
  // Emergency fund (30 points max)
  const emergencyMonths = totalExpenses > 0 ? totalAssets / totalExpenses : 0;
  if (emergencyMonths >= 6) score += 30;
  else if (emergencyMonths >= 3) score += 20;
  else if (emergencyMonths >= 1) score += 10;
  
  // Asset accumulation (30 points max)
  if (totalAssets >= 1000000) score += 30;
  else if (totalAssets >= 500000) score += 20;
  else if (totalAssets >= 100000) score += 10;
  
  return Math.min(score, 100);
}

// Helper function to generate recommendations
function generateRecommendations(reportData) {
  const recommendations = [];
  
  if (reportData.summary.savingsRate < 20) {
    recommendations.push({
      category: 'Savings',
      priority: 'High',
      recommendation: 'Your savings rate is below 20%. Try to reduce discretionary expenses and increase your monthly savings.'
    });
  }
  
  if (reportData.healthIndicators.emergencyFundMonths < 3) {
    recommendations.push({
      category: 'Emergency Fund',
      priority: 'High',
      recommendation: 'Build an emergency fund covering at least 3-6 months of expenses for financial security.'
    });
  }
  
  const behindGoals = reportData.goalProgress.filter(g => g.status === 'Behind');
  if (behindGoals.length > 0) {
    recommendations.push({
      category: 'Goals',
      priority: 'Medium',
      recommendation: `You have ${behindGoals.length} goal(s) falling behind schedule. Consider increasing contributions or extending timelines.`
    });
  }
  
  if (reportData.summary.totalAssets < 100000) {
    recommendations.push({
      category: 'Wealth Building',
      priority: 'Medium',
      recommendation: 'Start building your asset base through systematic investments in mutual funds or other vehicles.'
    });
  }

  if (reportData.summary.savingsRate >= 30) {
    recommendations.push({
      category: 'Financial Health',
      priority: 'Low',
      recommendation: 'Excellent savings rate! Consider diversifying investments for long-term wealth creation.'
    });
  }
  
  return recommendations;
}

// ===========================
// 🧾 PDF CONTENT
// ===========================
function generatePDFContent(doc, report) {
  const { reportData, reportType, reportPeriod, user } = report;
  const formatCurrency = num => `₹${Math.round(num || 0).toLocaleString('en-IN')}`;
  const formatPercentage = num => `${(num || 0).toFixed(2)}%`;

  // Header
  doc.fontSize(24).fillColor('#2c3e50').text('Financial Report', { align: 'center' });
  doc.moveDown(0.5);
  
  // Report Info
  doc.fontSize(12).fillColor('#34495e');
  doc.text(`Report Type: ${reportType}`, { align: 'center' });
  doc.text(`User: ${user.name}`, { align: 'center' });
  doc.text(`Generated On: ${new Date(report.generatedAt).toLocaleDateString('en-IN')}`, { align: 'center' });
  doc.moveDown(2);

  // Financial Summary Section
  doc.fontSize(16).fillColor('#2980b9').text('Financial Summary', { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(11).fillColor('#2c3e50');
  doc.text(`Total Monthly Income: ${formatCurrency(reportData.summary.totalIncome)}`);
  doc.text(`Total Monthly Expenses: ${formatCurrency(reportData.summary.totalExpenses)}`);
  doc.text(`Monthly Savings: ${formatCurrency(reportData.summary.monthlySavings)}`);
  doc.text(`Savings Rate: ${formatPercentage(reportData.summary.savingsRate)}`);
  doc.text(`Total Assets: ${formatCurrency(reportData.summary.totalAssets)}`);
  doc.text(`Net Worth: ${formatCurrency(reportData.summary.netWorth)}`);
  doc.moveDown(1.5);

  // Health Indicators
  doc.fontSize(16).fillColor('#2980b9').text('Financial Health Indicators', { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(11).fillColor('#2c3e50');
  doc.text(`Financial Health Score: ${reportData.healthIndicators.financialHealthScore.toFixed(0)}/100`);
  doc.text(`Savings to Income Ratio: ${formatPercentage(reportData.healthIndicators.savingsToIncomeRatio)}`);
  doc.text(`Emergency Fund: ${reportData.healthIndicators.emergencyFundMonths.toFixed(1)} months`);
  doc.moveDown(1.5);

  // Income Breakdown
  if (reportData.incomeBreakdown && Object.keys(reportData.incomeBreakdown).length > 0) {
    doc.fontSize(16).fillColor('#2980b9').text('Income Breakdown', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(11).fillColor('#2c3e50');
    Object.entries(reportData.incomeBreakdown).forEach(([key, value]) => {
      const label = key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1');
      doc.text(`${label}: ${formatCurrency(value)}`);
    });
    doc.moveDown(1.5);
  }

  // Expense Breakdown
  if (reportData.expenseBreakdown && reportData.expenseBreakdown.length > 0) {
    doc.fontSize(16).fillColor('#2980b9').text('Expense Breakdown', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(11).fillColor('#2c3e50');
    reportData.expenseBreakdown.forEach(expense => {
      doc.text(`${expense.category}: ${formatCurrency(expense.amount)} (${formatPercentage(expense.percentage)})`);
    });
    doc.moveDown(1.5);
  }

  // Goal Progress
  if (reportData.goalProgress && reportData.goalProgress.length > 0) {
    doc.addPage();
    doc.fontSize(16).fillColor('#2980b9').text('Goal Progress', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(11).fillColor('#2c3e50');
    reportData.goalProgress.forEach(goal => {
      doc.text(`${goal.goalName}: ${formatPercentage(goal.progressPercentage)} - ${goal.status}`);
      doc.text(`  Current: ${formatCurrency(goal.currentAmount)} / Target: ${formatCurrency(goal.targetAmount)}`);
      doc.text(`  ${goal.monthsRemaining} months remaining`);
      doc.moveDown(0.5);
    });
    doc.moveDown(1);
  }

  // Recommendations
  if (reportData.recommendations && reportData.recommendations.length > 0) {
    doc.fontSize(16).fillColor('#2980b9').text('Recommendations', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(11).fillColor('#2c3e50');
    reportData.recommendations.forEach((rec, index) => {
      doc.text(`${index + 1}. [${rec.priority} Priority] ${rec.category}:`);
      doc.text(`   ${rec.recommendation}`);
      doc.moveDown(0.5);
    });
  }

  // Footer
  doc.fontSize(8).fillColor('#95a5a6').text(
    'This report is generated automatically based on your financial data. Please consult a financial advisor for personalized advice.',
    50,
    doc.page.height - 50,
    { align: 'center', width: doc.page.width - 100 }
  );
}