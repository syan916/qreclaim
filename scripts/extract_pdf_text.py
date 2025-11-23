"""
PDF Text Extraction Script for FYP Report Analysis
This script extracts text from the FYP report PDF to analyze the methodology
"""

from pypdf import PdfReader
import os

def extract_pdf_text(pdf_path):
    """
    Extract text from PDF file
    
    Args:
        pdf_path (str): Path to the PDF file
        
    Returns:
        str: Extracted text content
    """
    try:
        # Check if file exists
        if not os.path.exists(pdf_path):
            return f"Error: PDF file not found at {pdf_path}"
        
        # Create PDF reader
        reader = PdfReader(pdf_path)
        
        # Extract text from all pages
        full_text = ""
        total_pages = len(reader.pages)
        
        print(f"Processing {total_pages} pages...")
        
        for page_num, page in enumerate(reader.pages, 1):
            print(f"Extracting page {page_num}/{total_pages}")
            page_text = page.extract_text()
            full_text += f"\n--- PAGE {page_num} ---\n"
            full_text += page_text
            full_text += "\n"
        
        return full_text
        
    except Exception as e:
        return f"Error extracting text from PDF: {str(e)}"

def save_extracted_text(text, output_path):
    """
    Save extracted text to a file
    
    Args:
        text (str): Text content to save
        output_path (str): Path to save the text file
    """
    try:
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(text)
        print(f"Text saved to: {output_path}")
    except Exception as e:
        print(f"Error saving text: {str(e)}")

def main():
    # Path to the FYP report PDF
    pdf_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'md', 'RSDY3S1_LSY_Project I Report.pdf')
    
    # Output path for extracted text
    output_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'md', 'fyp_report_extracted.txt')
    
    print("Starting PDF text extraction...")
    print(f"PDF Path: {pdf_path}")
    
    # Extract text
    extracted_text = extract_pdf_text(pdf_path)
    
    # Save extracted text
    save_extracted_text(extracted_text, output_path)
    
    # Print first 1000 characters as preview
    print("\n--- PREVIEW (First 1000 characters) ---")
    print(extracted_text[:1000])
    print("...")
    
    print(f"\nTotal extracted text length: {len(extracted_text)} characters")

if __name__ == "__main__":
    main()
