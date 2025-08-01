from fastapi import FastAPI, HTTPException, status, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from typing import List, Any, Optional, Union
from datetime import datetime
import os
import uvicorn

app = FastAPI(
    title="Stack API",
    description="A RESTful API for stack operations",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8080"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
@app.get("/alerts")
def get_alerts():
    return [
        {"id": 1, "lat": 26.89, "lon": 75.76, "msg": "Accident reported"},
        {"id": 2, "lat": 26.88, "lon": 75.75, "msg": "Roadblock ahead"},
    ]

# Global stack
stack = []



# Pydantic models for request bodies
class PushRequest(BaseModel):
    element: Any = Field(..., description="Element to push to the stack")

class PushMultipleRequest(BaseModel):
    elements: List[Any] = Field(..., description="List of elements to push to the stack")

class UpdateRequest(BaseModel):
    element: Any = Field(..., description="New element value")

class UpdateItem(BaseModel):
    index: int = Field(..., ge=0, description="Index of element to update")
    element: Any = Field(..., description="New element value")

class UpdateMultipleRequest(BaseModel):
    updates: List[UpdateItem] = Field(..., description="List of updates with index and element")

# Response models
class StackResponse(BaseModel):
    success: bool
    data: Optional[dict] = None
    message: str
    error: Optional[str] = None

def create_response(success: bool, message: str, data: dict = None, error: str = None):
    response_data = {
        "success": success,
        "message": message
    }
    if data is not None:
        response_data["data"] = data
    if error is not None:
        response_data["error"] = error
    return response_data

@app.get("/api/stack")
async def get_stack():
    """Get the current stack with metadata"""
    try:
        return create_response(
            success=True,
            message="Stack retrieved successfully",
            data={
                "stack": stack,
                "length": len(stack),
                "top": stack[-1] if stack else None
            }
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=create_response(
                success=False,
                message="Error retrieving stack",
                error=str(e)
            )
        )

@app.get("/api/stack/peek")
async def peek_stack():
    """Peek at the top element without removing it"""
    try:
        if not stack:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=create_response(
                    success=False,
                    message="Stack is empty"
                )
            )
        
        return create_response(
            success=True,
            message="Top element retrieved successfully",
            data={
                "top": stack[-1],
                "length": len(stack)
            }
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=create_response(
                success=False,
                message="Error peeking at stack",
                error=str(e)
            )
        )

@app.post("/api/stack/push")
async def push_element(request: PushRequest):
    """Push a single element to the stack"""
    try:
        stack.append(request.element)
        return create_response(
            success=True,
            message="Element pushed successfully",
            data={
                "element": request.element,
                "stack": stack,
                "length": len(stack)
            }
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=create_response(
                success=False,
                message="Error pushing element",
                error=str(e)
            )
        )

@app.post("/api/stack/push-multiple")
async def push_multiple_elements(request: PushMultipleRequest):
    """Push multiple elements to the stack"""
    try:
        if not request.elements:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=create_response(
                    success=False,
                    message="No elements provided"
                )
            )
        
        stack.extend(request.elements)
        return create_response(
            success=True,
            message=f"{len(request.elements)} elements pushed successfully",
            data={
                "elements": request.elements,
                "stack": stack,
                "length": len(stack)
            }
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=create_response(
                success=False,
                message="Error pushing multiple elements",
                error=str(e)
            )
        )

@app.put("/api/stack/update/{index}")
async def update_element(index: int, request: UpdateRequest):
    """Update element at a specific index"""
    try:
        if index < 0 or index >= len(stack):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=create_response(
                    success=False,
                    message=f"Index {index} out of range. Stack size: {len(stack)}"
                )
            )
        
        old_element = stack[index]
        stack[index] = request.element
        
        return create_response(
            success=True,
            message="Element updated successfully",
            data={
                "index": index,
                "old_element": old_element,
                "new_element": request.element,
                "stack": stack,
                "length": len(stack)
            }
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=create_response(
                success=False,
                message="Error updating element",
                error=str(e)
            )
        )

@app.put("/api/stack/update-multiple")
async def update_multiple_elements(request: UpdateMultipleRequest):
    """Update multiple elements at specified indices"""
    try:
        if not request.updates:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=create_response(
                    success=False,
                    message="No updates provided"
                )
            )
        
        updated_elements = []
        for update in request.updates:
            index = update.index
            element = update.element
            
            if index < 0 or index >= len(stack):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=create_response(
                        success=False,
                        message=f"Index {index} out of range"
                    )
                )
            
            old_element = stack[index]
            stack[index] = element
            updated_elements.append({
                "index": index,
                "old_element": old_element,
                "new_element": element
            })
        
        return create_response(
            success=True,
            message=f"{len(updated_elements)} elements updated successfully",
            data={
                "updates": updated_elements,
                "stack": stack,
                "length": len(stack)
            }
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=create_response(
                success=False,
                message="Error updating multiple elements",
                error=str(e)
            )
        )

@app.delete("/api/stack/pop")
async def pop_element():
    """Pop the top element from the stack"""
    try:
        if not stack:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=create_response(
                    success=False,
                    message="Stack is empty"
                )
            )
        
        popped_element = stack.pop()
        return create_response(
            success=True,
            message="Element popped successfully",
            data={
                "popped_element": popped_element,
                "stack": stack,
                "length": len(stack)
            }
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=create_response(
                success=False,
                message="Error popping element",
                error=str(e)
            )
        )

@app.delete("/api/stack/pop-multiple/{count}")
async def pop_multiple_elements(count: int):
    """Pop multiple elements from the stack"""
    try:
        if count <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=create_response(
                    success=False,
                    message="Count must be greater than 0"
                )
            )
        
        if count > len(stack):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=create_response(
                    success=False,
                    message=f"Cannot pop {count} elements. Stack only has {len(stack)} elements"
                )
            )
        
        popped_elements = []
        for _ in range(count):
            popped_elements.append(stack.pop())
        
        return create_response(
            success=True,
            message=f"{count} elements popped successfully",
            data={
                "popped_elements": popped_elements,
                "stack": stack,
                "length": len(stack)
            }
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=create_response(
                success=False,
                message="Error popping multiple elements",
                error=str(e)
            )
        )

@app.delete("/api/stack/clear")
async def clear_stack():
    """Clear the entire stack"""
    try:
        cleared_count = len(stack)
        stack.clear()
        
        return create_response(
            success=True,
            message=f"Stack cleared successfully. Removed {cleared_count} elements",
            data={
                "cleared_count": cleared_count,
                "stack": stack,
                "length": len(stack)
            }
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=create_response(
                success=False,
                message="Error clearing stack",
                error=str(e)
            )
        )

@app.get("/api/stack/size")
async def get_stack_size():
    """Get the current size of the stack"""
    try:
        return create_response(
            success=True,
            message="Stack size retrieved successfully",
            data={
                "size": len(stack)
            }
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=create_response(
                success=False,
                message="Error getting stack size",
                error=str(e)
            )
        )

@app.get("/api/stack/is-empty")
async def is_stack_empty():
    """Check if the stack is empty"""
    try:
        is_empty = len(stack) == 0
        return create_response(
            success=True,
            message="Stack empty status retrieved successfully",
            data={
                "is_empty": is_empty,
                "size": len(stack)
            }
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=create_response(
                success=False,
                message="Error checking if stack is empty",
                error=str(e)
            )
        )

@app.get("/accident")
async def health_check():
    """Health check endpoint"""
    return create_response(
        success=True,
        message="API is running",
        data={
            "timestamp": datetime.now().isoformat(),
            "stack_size": len(stack)
        }
    )

# Custom exception handlers
@app.exception_handler(404)
async def not_found_handler(request, exc):
    return JSONResponse(
        status_code=404,
        content=create_response(
            success=False,
            message="Endpoint not found"
        )
    )

@app.exception_handler(500)
async def internal_error_handler(request, exc):
    return JSONResponse(
        status_code=500,
        content=create_response(
            success=False,
            message="Something went wrong!",
            error="Internal server error"
        )
    )

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 10000))
    
    print(f"Stack API server is running on port {port}")
    print(f"Health check: http://localhost:{port}/accident")
    print(f"API Documentation: http://localhost:{port}/docs")
    print(f"API Redoc: http://localhost:{port}/redoc")
    print("\nAvailable endpoints:")
    
    print("GET    /api/stack           - Get current stack")
    print("GET    /api/stack/peek      - Peek at top element")
    print("POST   /api/stack/push      - Push element to stack")
    print("POST   /api/stack/push-multiple - Push multiple elements")
    print("PUT    /api/stack/update/{index} - Update element at specific index")
    print("PUT    /api/stack/update-multiple - Update multiple elements")
    print("DELETE /api/stack/pop       - Pop element from stack")
    print("DELETE /api/stack/pop-multiple/{count} - Pop multiple elements")
    print("DELETE /api/stack/clear     - Clear entire stack")
    print("GET    /api/stack/size      - Get stack size")
    print("GET    /api/stack/is-empty  - Check if stack is empty")
    
    uvicorn.run(app, host="0.0.0.0", port=port)