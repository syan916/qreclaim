from flask import Blueprint, render_template

test_bp = Blueprint('test', __name__)

@test_bp.route('/test-tabs')
def test_tabs():
    """Test page for tab system functionality"""
    return render_template('test-tabs.html')