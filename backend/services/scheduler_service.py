"""
Scheduler Service for Qreclaim Lost-and-Found System
Handles automatic background tasks using APScheduler.
"""

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger
from apscheduler.triggers.cron import CronTrigger
from datetime import datetime, timezone, timedelta
import logging
import atexit
from .status_service import update_overdue_items
from ..database import db

# Configure logging for scheduler
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class QreclaimScheduler:
    """
    Background scheduler for Qreclaim system tasks.
    Handles automatic status updates and maintenance tasks.
    """
    
    def __init__(self):
        """Initialize the scheduler with background execution."""
        self.scheduler = BackgroundScheduler(
            timezone='UTC',  # Use UTC for consistency
            job_defaults={
                'coalesce': False,  # Don't combine multiple missed executions
                'max_instances': 1,  # Only one instance of each job at a time
                'misfire_grace_time': 300  # 5 minutes grace period for missed jobs
            }
        )
        self.is_running = False
        
        # Register shutdown handler
        atexit.register(self.shutdown)
    
    def start(self):
        """Start the scheduler and add all jobs."""
        if not self.is_running:
            try:
                # Add the overdue items update job
                self.add_overdue_update_job()
                
                # Add the expired claims update job
                self.add_expired_claims_update_job()
                
                # Start the scheduler
                self.scheduler.start()
                self.is_running = True
                
                logger.info("✅ Qreclaim Scheduler started successfully")
                logger.info("📅 Scheduled jobs:")
                for job in self.scheduler.get_jobs():
                    logger.info(f"   - {job.name}: {job.trigger}")
                    
            except Exception as e:
                logger.error(f"❌ Failed to start scheduler: {str(e)}")
                raise
    
    def add_overdue_update_job(self):
        """
        Add job to update overdue found items.
        Runs daily at 2:00 AM UTC to avoid peak usage hours.
        """
        try:
            # Schedule daily at 2:00 AM UTC
            self.scheduler.add_job(
                func=self._update_overdue_items_job,
                trigger=CronTrigger(hour=2, minute=0),  # 2:00 AM daily
                id='update_overdue_items',
                name='Update Overdue Found Items',
                replace_existing=True
            )
            
            # Also add an immediate job for testing (runs once after 30 seconds)
            self.scheduler.add_job(
                func=self._update_overdue_items_job,
                trigger='date',
                run_date=datetime.now(timezone.utc) + timedelta(seconds=30),
                id='initial_overdue_check',
                name='Initial Overdue Items Check',
                replace_existing=True
            )
            
            logger.info("📋 Added overdue items update job (daily at 2:00 AM UTC)")
            
        except Exception as e:
            logger.error(f"❌ Failed to add overdue update job: {str(e)}")
            raise

    def update_expired_claims(self):
        """Update approved claims to expired when QR codes have expired."""
        try:
            current_time = datetime.now(timezone.utc)
            
            # Find all claims that could potentially be expired
            # We'll filter by status and QR validity in the loop
            all_claims_query = db.collection('claims').stream()
            
            expired_count = 0
            skipped_count = 0
            
            for claim_doc in all_claims_query:
                claim_data = claim_doc.to_dict()
                claim_id = claim_doc.id
                
                current_status = claim_data.get('status', '').lower()
                
                # Skip claims that are in terminal states and should not be expired
                if current_status in ['completed', 'rejected', 'cancelled', 'expired']:
                    logger.debug(f"⏭️ Skipping claim {claim_id} - status is {current_status}")
                    skipped_count += 1
                    continue
                
                # Skip pending claims - they haven't been approved yet
                if current_status == 'pending':
                    logger.debug(f"⏭️ Skipping claim {claim_id} - status is pending (not approved)")
                    skipped_count += 1
                    continue
                
                # Only process approved claims with valid QR tokens
                if current_status != 'approved':
                    logger.debug(f"⏭️ Skipping claim {claim_id} - status is {current_status} (not approved)")
                    skipped_count += 1
                    continue
                
                # Check if claim has QR code data and is expired
                # QR codes are stored with 'qr_token' field, not 'qr_code'
                has_qr_token = 'qr_token' in claim_data and claim_data['qr_token']
                has_expires_at = 'expires_at' in claim_data and claim_data['expires_at']
                
                if not has_qr_token:
                    logger.debug(f"⏭️ Skipping claim {claim_id} - no QR token")
                    skipped_count += 1
                    continue
                
                if not has_expires_at:
                    logger.debug(f"⏭️ Skipping claim {claim_id} - no expiration date")
                    skipped_count += 1
                    continue
                
                expires_at = claim_data['expires_at']
                if expires_at >= current_time:
                    logger.debug(f"⏭️ Skipping claim {claim_id} - QR not expired yet")
                    skipped_count += 1
                    continue
                
                # This claim should be expired - update it
                db.collection('claims').document(claim_id).update({
                    "status": "expired",
                    ##"updated_at": current_time,
                
                })
                
                expired_count += 1
                logger.info(f"✅ Claim {claim_id} expired due to QR code expiration")
            
            if expired_count > 0:
                logger.info(f"📊 Updated {expired_count} approved claims to expired status")
            if skipped_count > 0:
                logger.debug(f"⏭️ Skipped {skipped_count} claims (not eligible for expiration)")
            if expired_count == 0 and skipped_count == 0:
                logger.debug("No claims found to process")
                
        except Exception as e:
            logger.error(f"❌ Error updating expired claims: {str(e)}")

    def add_expired_claims_update_job(self):
        """Add the expired claims update job to run every minute."""
        try:
            trigger = IntervalTrigger(minutes=1, timezone=timezone.utc)
            self.scheduler.add_job(
                func=self.update_expired_claims,
                trigger=trigger,
                id="update_expired_claims",
                name="Update expired claims status",
                replace_existing=True,
                max_instances=1,
                coalesce=True
            )
            logger.info("✅ Added expired claims update job (every minute)")
        except Exception as e:
            logger.error(f"❌ Failed to add expired claims update job: {str(e)}")
            raise
    
    def _update_overdue_items_job(self):
        """
        Job function to update overdue items.
        Wraps the status_service function with logging.
        """
        try:
            logger.info("🔄 Starting overdue items update...")
            start_time = datetime.now(timezone.utc)
            
            # Call the existing status service function
            result = update_overdue_items()
            
            end_time = datetime.now(timezone.utc)
            duration = (end_time - start_time).total_seconds()
            
            if result.get('success'):
                updated_count = result.get('updated_count', 0)
                logger.info(f"✅ Overdue items update completed successfully")
                logger.info(f"📊 Updated {updated_count} items in {duration:.2f} seconds")
                
                if updated_count > 0:
                    logger.info("📋 Updated items:")
                    for item in result.get('updated_items', []):
                        logger.info(f"   - {item['name']} (ID: {item['id']}) - {item['days_overdue']} days overdue")
                else:
                    logger.info("📋 No items needed status update")
                    
            else:
                error_msg = result.get('error', 'Unknown error')
                logger.error(f"❌ Overdue items update failed: {error_msg}")
                
        except Exception as e:
            logger.error(f"❌ Error in overdue items update job: {str(e)}")
    
    def add_manual_job(self, func, trigger, job_id, name, **kwargs):
        """
        Add a custom job to the scheduler.
        
        Args:
            func: Function to execute
            trigger: APScheduler trigger (interval, cron, date)
            job_id: Unique job identifier
            name: Human-readable job name
            **kwargs: Additional job parameters
        """
        try:
            self.scheduler.add_job(
                func=func,
                trigger=trigger,
                id=job_id,
                name=name,
                replace_existing=True,
                **kwargs
            )
            logger.info(f"📋 Added custom job: {name}")
            
        except Exception as e:
            logger.error(f"❌ Failed to add custom job {name}: {str(e)}")
            raise
    
    def remove_job(self, job_id):
        """Remove a job from the scheduler."""
        try:
            self.scheduler.remove_job(job_id)
            logger.info(f"🗑️ Removed job: {job_id}")
            
        except Exception as e:
            logger.error(f"❌ Failed to remove job {job_id}: {str(e)}")
    
    def get_jobs(self):
        """Get list of all scheduled jobs."""
        return self.scheduler.get_jobs()
    
    def get_job_status(self, job_id):
        """Get status of a specific job."""
        try:
            job = self.scheduler.get_job(job_id)
            if job:
                return {
                    'id': job.id,
                    'name': job.name,
                    'next_run': job.next_run_time,
                    'trigger': str(job.trigger)
                }
            return None
            
        except Exception as e:
            logger.error(f"❌ Failed to get job status for {job_id}: {str(e)}")
            return None
    
    def shutdown(self):
        """Shutdown the scheduler gracefully."""
        if self.is_running:
            try:
                self.scheduler.shutdown(wait=True)
                self.is_running = False
                logger.info("🛑 Qreclaim Scheduler shutdown successfully")
                
            except Exception as e:
                logger.error(f"❌ Error during scheduler shutdown: {str(e)}")

# Global scheduler instance
qreclaim_scheduler = QreclaimScheduler()

def start_scheduler():
    """Start the global scheduler instance."""
    qreclaim_scheduler.start()

def get_scheduler():
    """Get the global scheduler instance."""
    return qreclaim_scheduler

def stop_scheduler():
    """Stop the global scheduler instance."""
    qreclaim_scheduler.shutdown()