# Advanced CBM Calculator

A modern, responsive web application for calculating shipping volumes (Cubic Meters), managing product directories, and organizing shipments. Built with React and Vite, it features a sleek UI with light/dark mode support and robust export capabilities.

## Features

- **Custom CBM Calculation**: Quickly calculate CBM using dimensions (length, width, height) and quantities, with one-click unit conversion (mm/cm/inches/feet/meters).
- **Active Shipment Management**: Track volumetric weight, chargeable weight, container volume & payload utilization, overfill warnings with multi-container suggestions, and PO numbers — all persisted across sessions.
- **Freight Modes**: Ocean FCL, Ocean LCL (W/M rule), Air (÷6000), and Courier (÷5000) chargeable-weight calculations.
- **Product Directory**: Save, edit, delete, and search products (including pre-calculated CBM products) for quick addition to shipments.
- **Import/Export Data**: Import from CSV/Excel with column auto-mapping and per-unit/per-shipper weight basis selection; export shipment summaries to Excel, CSV, and PDF with full precision.
- **Undo-friendly**: Destructive actions (clear/delete/remove) show an Undo toast instead of blocking confirm dialogs.
- **Modern UI**: Styled with Tailwind CSS, featuring smooth animations and a responsive design that works on all devices.
- **Dark Mode**: Full support for system and manual dark mode toggling.

## Tech Stack

- **Framework**: [React 19](https://react.dev/) with [Vite](https://vitejs.dev/)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **PDF Generation**: [jsPDF](https://github.com/parallax/jsPDF) & [jsPDF-AutoTable](https://github.com/simonbengtsson/jsPDF-AutoTable)
- **Data Parsing**: [PapaParse](https://www.papaparse.com/) (CSV) & [SheetJS (xlsx)](https://sheetjs.com/) (Excel)

## Getting Started

### Prerequisites

- Node.js (v18 or higher recommended)
- npm or yarn

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/advanced-cbm-calculator.git
   ```
2. Navigate to the project directory:
   ```bash
   cd advanced-cbm-calculator
   ```
3. Install dependencies:
   ```bash
   npm install
   ```

### Running the App

Start the development server:
```bash
npm run dev
```

### Running Tests

```bash
npm test
```

### Building for Production

Build the app for production:
```bash
npm run build
```
